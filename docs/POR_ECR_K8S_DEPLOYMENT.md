# POR: ECR Push and Kubernetes Deployment

## Objective

Deploy Room Connect as a service on Kubernetes, backed by AWS ECR for container image storage. Establish a pipeline where code changes merged to `main` automatically produce a new Docker image in ECR, and the running K8s deployment picks up the update.

## Prerequisites

- AWS CLI configured with SSO access to the Data Account (`009160059619`)
- `kubectl` configured to target the destination EKS cluster
- The ECR repository `stability/room-connect-ecr` exists in `us-west-2` (created via [terraform-infra](https://github.com/Stability-AI/terraform-infra))
- The repo `Stability-AI/room-connect-ecr` is added to the IAM allowlist for the `GitHubOIDCRole` in terraform-infra
- Docker installed locally (for manual push)

## Phase 1: Push Current Version to ECR

### 1.1 Authenticate to AWS and ECR

```bash
aws sso login --profile sai-data
aws sts get-caller-identity  # Verify account 009160059619
```

### 1.2 Build and push manually using the Makefile

```bash
make docker-build
make docker-push
```

This builds the production image from the root `Dockerfile` (multi-stage: Node 20 frontend build + Python 3.11 backend) and pushes it to:

```
009160059619.dkr.ecr.us-west-2.amazonaws.com/stability/room-connect-ecr:latest
```

### 1.3 Verify the image is in ECR

```bash
aws ecr describe-images \
  --repository-name stability/room-connect-ecr \
  --region us-west-2 \
  --query 'imageDetails[*].{Tag:imageTags,Pushed:imagePushedAt,Size:imageSizeInBytes}' \
  --output table
```

### 1.4 Tag the initial release

Before CI takes over versioning, tag the repo so `python-semantic-release` has a baseline:

```bash
git tag -a v0.0.0 -m "Initial release"
git push origin v0.0.0
```

## Phase 2: Set Up Kubernetes on a GPU EC2 Instance

### 2.1 Why GPU

The Blender Cycles renderer in `backend/rendering/cycles_renderer.py` calls `_enable_gpu()` on every render, probing for OPTIX then CUDA devices. Without a GPU, renders fall back to CPU and are significantly slower (minutes vs seconds per frame). A GPU node is required for production-quality render performance.

### 2.2 Node group / instance type

Use an EKS managed node group with GPU instances. Recommended instance types:

| Instance | GPU | VRAM | Notes |
|----------|-----|------|-------|
| `g4dn.xlarge` | 1x T4 | 16 GB | Cost-effective, sufficient for single-scene rendering |
| `g5.xlarge` | 1x A10G | 24 GB | Better for large scenes (700MB+ GLB) |

The node group must use the **EKS-optimized GPU AMI** (`amazon-linux-2-gpu`) which includes the NVIDIA driver and `nvidia-container-toolkit`.

### 2.3 NVIDIA device plugin

The cluster needs the NVIDIA device plugin DaemonSet to expose `nvidia.com/gpu` as a schedulable resource:

```bash
kubectl apply -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.17.0/deployments/static/nvidia-device-plugin.yml
```

Verify GPU nodes are advertising the resource:

```bash
kubectl get nodes -o json | jq '.items[].status.allocatable["nvidia.com/gpu"]'
```

### 2.4 Update the Deployment manifest for GPU

The current `k8s/deployment.yaml` needs two changes for GPU scheduling:

1. Add a GPU resource request/limit so the pod lands on a GPU node
2. Increase memory limits -- Blender + large GLB scenes need more headroom

Updated resource block:

```yaml
resources:
  requests:
    memory: "2Gi"
    cpu: "1000m"
    nvidia.com/gpu: "1"
  limits:
    memory: "8Gi"
    cpu: "4000m"
    nvidia.com/gpu: "1"
```

Additionally, reduce replicas to 1 initially (GPU instances are expensive, and each pod claims a full GPU):

```yaml
spec:
  replicas: 1
```

### 2.5 ECR image pull authentication

EKS nodes in the same AWS account (`009160059619`) can pull from ECR natively -- no `imagePullSecrets` needed. If the cluster is in a different account, create an ECR pull-through cache or attach the `AmazonEC2ContainerRegistryReadOnly` policy to the node IAM role.

### 2.6 Apply the manifests

```bash
make k8s-apply
kubectl get pods -l app=room-connect-ecr -w
```

Wait for the pod to reach `Running` status with `1/1` ready containers.

### 2.7 Production Dockerfile: Blender system dependencies

The current root `Dockerfile` uses `python:3.11-slim` and does NOT install the Blender/bpy system dependencies (GL, EGL, etc.) that the `backend/Dockerfile` does. For GPU rendering to work on K8s, the production Dockerfile must be updated to include these libraries. Specifically:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxi6 libxxf86vm1 libxfixes3 libxrender1 \
    libgl1 libglx-mesa0 libegl1 \
    libglib2.0-0 libsm6 libxext6 libxkbcommon0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
```

This should be added to the Python stage of the root `Dockerfile`, and the platform should be pinned to `linux/amd64` (matching the backend Dockerfile) since `bpy` wheels are amd64-only.

The Draco library copy step from `backend/Dockerfile` should also be carried over if Draco-compressed GLB support is needed in production.

## Phase 3: Verify Room Connect Works End-to-End

### 3.1 Access the service

Option A -- Port-forward for quick testing:

```bash
kubectl port-forward svc/room-connect-ecr 8080:80
# Open http://localhost:8080 in browser
```

Option B -- Expose via Ingress (when ready for permanent access):

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: room-connect-ecr
  annotations:
    kubernetes.io/ingress.class: nginx  # or alb
spec:
  rules:
    - host: room-connect.internal.stability.ai
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: room-connect-ecr
                port:
                  number: 80
```

### 3.2 Frontend verification

| Check | How | Expected |
|-------|-----|----------|
| App loads | Navigate to root URL | React UI renders with toolbar and 3D viewport |
| GLB loading | Click "Load Scene", select a test GLB | Scene appears in viewport, shading modes work |
| Volume drawing | Switch to Connectivity tab, draw a volume | AABB box appears and can be edited |
| Object detection | Switch to Object Detection tab, filter by name | OOBBs appear around matched meshes |

### 3.3 Backend verification

| Check | How | Expected |
|-------|-----|----------|
| Health endpoint | `curl http://localhost:8080/api/health` | Returns `200 OK` |
| File upload | Load a GLB in the UI | Chunked upload completes, file appears on backend |
| Rendering | Place a camera, click "Render" | SSE logs stream in real time, ZIP download available |
| GPU utilization | During render: `kubectl exec <pod> -- nvidia-smi` | GPU shows active process with memory usage |

### 3.4 Troubleshooting

- **Pod stuck in `Pending`**: Check `kubectl describe pod <pod>` -- likely no GPU node available or insufficient resources. Verify the node group is scaled up.
- **Pod in `CrashLoopBackOff`**: Check `kubectl logs <pod>` -- likely missing system libraries (see Section 2.7) or bpy import failure.
- **Render falls back to CPU**: Check render logs for "No GPU devices found". Verify the NVIDIA device plugin is running and the container can see `/dev/nvidia*` devices.
- **Large GLB upload fails**: The gunicorn timeout is set to default in the production Dockerfile. May need to add `--timeout 600` to the CMD, matching the dev backend config.

## Phase 4: Verify CI/CD Pipeline Pushes Updates to K8s

### 4.1 End-to-end flow

```
Code change -> PR -> merge to main -> on_merge.yaml runs ->
  semantic-release tags vX.Y.Z -> Docker build -> push to ECR ->
  K8s picks up new image
```

### 4.2 Test with a small change

1. Create a feature branch and make a visible change (e.g., update the app title in `frontend/src/App.jsx`)
2. Open a PR -- verify `on_pr.yaml` runs:
   - Pre-commit hooks pass
   - Docker image builds and pushes with tag `pr-<num>-<sha>`
   - PR comment appears with the image reference
3. Merge the PR -- verify `on_merge.yaml` runs:
   - Semantic release creates a new tag (e.g., `v0.1.0` for a `feat:` commit)
   - Docker image pushes with both `v0.1.0` and `latest` tags
4. Verify ECR has the new image:
   ```bash
   aws ecr describe-images --repository-name stability/room-connect-ecr --region us-west-2
   ```

### 4.3 Roll out the new image to K8s

The deployment uses `imagePullPolicy: Always` (default for `:latest` tag). Trigger a rollout:

```bash
make k8s-restart
```

This runs `kubectl rollout restart deployment/room-connect-ecr`, which causes each pod to pull the latest image from ECR. Verify:

```bash
kubectl rollout status deployment/room-connect-ecr
kubectl get pods -l app=room-connect-ecr
```

Confirm the pods are running the new image:

```bash
kubectl describe pod -l app=room-connect-ecr | grep "Image:"
```

### 4.4 Optional: Automate K8s rollout on ECR push

To fully close the loop (ECR push -> K8s update with zero manual steps), add a step to the `on_merge.yaml` workflow after the Docker push:

```yaml
- name: Restart K8s deployment
  env:
    CLUSTER_NAME: <your-eks-cluster>
  run: |
    aws eks update-kubeconfig --name $CLUSTER_NAME --region ${{ env.AWS_REGION }}
    kubectl rollout restart deployment/room-connect-ecr
    kubectl rollout status deployment/room-connect-ecr --timeout=300s
```

This requires the GitHub Actions runner to have `eks:DescribeCluster` permission and the runner's IAM role to be mapped in the EKS `aws-auth` ConfigMap. Alternatively, use a tool like Argo CD or Flux for GitOps-style image updates.

## Summary of Required Actions

| Step | Action | Owner |
|------|--------|-------|
| 1 | Create ECR repo `stability/room-connect-ecr` in terraform-infra | Infra team |
| 2 | Add `Stability-AI/room-connect-ecr` to GitHubOIDCRole allowlist | Infra team |
| 3 | Update root Dockerfile with bpy system deps + platform pin | Dev team |
| 4 | Update `k8s/deployment.yaml` with GPU resource requests | Dev team |
| 5 | Tag `v0.0.0` and push initial image | Dev team |
| 6 | Provision GPU node group in EKS | Infra team |
| 7 | Install NVIDIA device plugin | Infra team |
| 8 | Apply K8s manifests and verify | Dev team |
| 9 | Test CI/CD pipeline end-to-end with a PR | Dev team |
| 10 | Optionally add automated K8s rollout to on_merge workflow | Dev team |
