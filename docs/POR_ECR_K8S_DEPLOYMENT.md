# POR: ECR Push and Kubernetes Deployment

## Objective

Deploy Room Connect as a service on the data Kubernetes cluster (`data1-us-west-2`), backed by AWS ECR for container image storage. Establish a pipeline where code changes merged to `main` automatically produce a new Docker image in ECR, and ArgoCD syncs the running deployment from the `kubernetes-data` GitOps repo.

## Architecture

Room Connect is a React + Flask web app with a Blender Cycles GPU renderer. It needs:
- A dedicated ALB (the app handles its own auth or is internal-only initially)
- GPU scheduling for Blender Cycles rendering (OPTIX/CUDA)
- Persistent upload storage (users upload 700MB+ GLB files)

This maps to **Pattern A (Kustomize + ALB)** from the company deployment guide, with GPU nodeSelector targeting the existing `data-gpu-g6g7` Karpenter pool.

```
[room-connect-ecr repo] --CI--> [ECR: stability/room-connect-ecr]
[kubernetes-data repo]  --ArgoCD--> [data1-us-west-2 cluster]
[terraform-infra repo]  --CI--> [ECR repo + IRSA role + DNS]
```

## Cluster Context

| Property | Value |
|---|---|
| Cluster | `data1-us-west-2` (EKS) |
| AWS account | `009160059619` (data) |
| Region | `us-west-2` |
| GitOps repo | `Stability-AI/kubernetes-data` |
| Infra repo | `Stability-AI/terraform-infra` |
| Namespace | `data-room-connect` |
| ECR image | `009160059619.dkr.ecr.us-west-2.amazonaws.com/stability/room-connect-ecr` |
| IRSA role | `data1-us-west-2-room-connect-irsa` |
| DNS | `room-connect.data.stability.ai` |
| Karpenter pool | `data-cpu-realtime` (on-demand c6i/c7i/m6i/m7i; GPU `data-gpu-g6g7` available for future upgrade) |

## Prerequisites

| Item | Where | Status |
|---|---|---|
| Docker image in ECR | `stability/room-connect-ecr` | Needs terraform-infra PR to create repo |
| IRSA role | terraform-infra `eks.tf` + `iam.tf` | Needs PR |
| GitHub Actions OIDC allowlist | terraform-infra IAM | Needs PR |
| K8s manifests | kubernetes-data `apps/room-connect/` | Needs PR |
| ArgoCD ApplicationSet | kubernetes-data `applications/room-connect.yaml` | Needs PR |
| DNS (Route 53 A record) | terraform-infra | Needs PR |
| GPU pool (`data-gpu-g6g7`) | kubernetes-infra | Already operational (since 2026-05-26) |
| NVIDIA device plugin | kubernetes-infra | Already deployed on data1 |
| Production Dockerfile updates | room-connect-ecr repo | Needs work (see Phase 1) |

## Phase 0: Update the Production Dockerfile

The current root `Dockerfile` uses `python:3.11-slim` without the Blender/bpy system dependencies that the `backend/Dockerfile` has. For GPU rendering to work, the production image must include them.

Changes to `Dockerfile`:

1. Pin platform to `linux/amd64` (bpy wheels are amd64-only)
2. Add bpy system libraries (GL, EGL, etc.) to the Python stage
3. Carry over the Draco library copy step from `backend/Dockerfile`
4. Add `--timeout 600` to gunicorn CMD (large file uploads + long renders)

```dockerfile
# Stage 2: Python backend
FROM --platform=linux/amd64 python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libxi6 libxxf86vm1 libxfixes3 libxrender1 \
    libgl1 libglx-mesa0 libegl1 \
    libglib2.0-0 libsm6 libxext6 libxkbcommon0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# ... rest of build ...

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--timeout", "600", "--worker-class", "gthread", "--threads", "4", "app:app"]
```

## Phase 1: terraform-infra PR

A single PR to `Stability-AI/terraform-infra` under `environments/prod/aws/data/` creates three resources.

### 1.1 ECR repository

ECR repos are provisioned via Terraform, not ad-hoc CLI commands. The `DataEngineeringEKSAdmin` role does not have `ecr:CreateRepository` permission by design.

Add to the appropriate `.tf` file (e.g., `ecr.tf` or wherever other `stability/*` repos are defined):

```hcl
resource "aws_ecr_repository" "room_connect_ecr" {
  name                 = "stability/room-connect-ecr"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "room_connect_ecr" {
  repository = aws_ecr_repository.room_connect_ecr.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 PR images"
        selection    = { tagStatus = "tagged", tagPrefixList = ["pr-"], countType = "imageCountMoreThan", countNumber = 10 }
        action       = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep last 30 release images"
        selection    = { tagStatus = "tagged", tagPrefixList = ["v"], countType = "imageCountMoreThan", countNumber = 30 }
        action       = { type = "expire" }
      }
    ]
  })
}
```

### 1.2 IRSA role

Room Connect needs S3 access for uploads (if using S3-backed storage in the future) but currently uses local disk. Minimal IRSA for now -- can be extended later.

```hcl
# eks.tf
module "irsa_room_connect" {
  source  = "aws-ia/eks-blueprints-addon/aws"
  version = "~> 1.1.1"

  create_release       = false
  create_role          = true
  create_policy        = false
  role_name            = "${module.eks_data1_us_west_2.cluster_name}-room-connect-irsa"
  role_name_use_prefix = false

  role_policies = {
    RoomConnectECRRead = aws_iam_policy.room_connect_ecr_read.arn
  }

  oidc_providers = {
    this = {
      provider_arn    = module.eks_data1_us_west_2.oidc_provider_arn
      namespace       = "data-room-connect"
      service_account = "room-connect"
    }
  }
}

# iam.tf
resource "aws_iam_policy" "room_connect_ecr_read" {
  name = "RoomConnectECRRead"
  policy = jsonencode({
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage", "ecr:BatchCheckLayerAvailability"]
        Resource = [aws_ecr_repository.room_connect_ecr.arn]
      }
    ]
  })
}
```

Add namespace to `local.eks_eso_namespaces` in `eks.tf`:
```hcl
eks_eso_namespaces = [
  # ... existing ...
  "data-room-connect",
]
```

### 1.3 GitHub Actions OIDC allowlist

Add `Stability-AI/room-connect-ecr` to the OIDC trust policy so CI can push images. This is in `iam.tf` where `GitHubOIDCRole` is defined -- add the repo to the existing list of allowed repositories.

### 1.4 DNS (Route 53)

```hcl
resource "aws_route53_record" "room_connect" {
  zone_id = data.aws_route53_zone.data_stability_ai.zone_id
  name    = "room-connect.data.stability.ai"
  type    = "A"
  alias {
    name                   = data.aws_lb.room_connect_alb.dns_name
    zone_id                = data.aws_lb.room_connect_alb.zone_id
    evaluate_target_health = true
  }
}
```

Note: The ALB is created by the ALB Ingress controller when the Ingress resource is applied. The Route 53 record can be created after the ALB exists, or use a placeholder and update once the ALB DNS is known.

## Phase 2: kubernetes-data PR

Pattern A manifests in `Stability-AI/kubernetes-data`.

### 2.1 Directory structure

```
kubernetes-data/
├── applications/
│   └── room-connect.yaml          # ArgoCD ApplicationSet
├── apps/
│   └── room-connect/
│       ├── kustomization.yaml
│       ├── deployment.yaml
│       ├── service.yaml
│       └── ingress.yaml
└── configs/
    └── room-connect/
        └── resources/
            ├── serviceaccount.yaml     # 2 SAs: app + external-secrets
            └── ...                     # ExternalSecrets if needed later
```

### 2.2 ApplicationSet

```yaml
# applications/room-connect.yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: room-connect
  namespace: argocd
spec:
  goTemplate: true
  goTemplateOptions: ["missingkey=error"]
  generators:
    - clusters:
        selector:
          matchLabels:
            cluster-name: aws-data1-us-west-2
            env: prod
  template:
    metadata:
      name: room-connect
    spec:
      project: data
      destination:
        name: '{{.name}}'
        namespace: data-room-connect
      sources:
        - repoURL: git@github.com:Stability-AI/kubernetes-data.git
          targetRevision: main
          path: apps/room-connect
        - repoURL: git@github.com:Stability-AI/kubernetes-data.git
          targetRevision: main
          path: configs/room-connect/resources
      syncPolicy:
        syncOptions:
          - CreateNamespace=true
```

### 2.3 Kustomization

```yaml
# apps/room-connect/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: data-room-connect
resources:
  - deployment.yaml
  - service.yaml
  - ingress.yaml
```

### 2.4 Deployment (CPU -- initially; GPU can be re-enabled later)

The initial deployment runs on CPU. Blender Cycles automatically falls back to CPU rendering when no GPU is detected. GPU scheduling was attempted first but caused 5-10 minute cold starts and scheduling failures due to Karpenter GPU node provisioning delays. CPU rendering is slower but sufficient for the proof-of-concept phase.

To re-enable GPU later, change `nodeSelector` to `lane: gpu-g6g7` / `workload: inference`, add the `nvidia.com/gpu` toleration and resource request. See the git history of `kubernetes-data` for the original GPU manifest.

```yaml
# apps/room-connect/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: room-connect
spec:
  replicas: 1
  selector:
    matchLabels:
      app: room-connect
  template:
    metadata:
      labels:
        app: room-connect
    spec:
      serviceAccountName: room-connect
      nodeSelector:
        lane: cpu-realtime
        workload: realtime
        owner: data
      tolerations:
        - key: team/data
          operator: Exists
          effect: NoSchedule
      containers:
        - name: room-connect
          image: 009160059619.dkr.ecr.us-west-2.amazonaws.com/stability/room-connect-ecr:0.1.0
          ports:
            - containerPort: 8080
          env:
            - name: UPLOAD_DIR
              value: /data/uploads
            - name: STATIC_DIR
              value: ./static
          resources:
            requests:
              memory: "2Gi"
              cpu: "1000m"
            limits:
              memory: "8Gi"
              cpu: "4000m"
          readinessProbe:
            httpGet:
              path: /api/health
              port: 8080
            initialDelaySeconds: 15
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /api/health
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 30
          volumeMounts:
            - name: uploads
              mountPath: /data/uploads
      volumes:
        - name: uploads
          emptyDir: {}
```

**Important:** Pin a specific version tag (e.g., `:0.1.0`), not `:latest`. Rollback is reverting the manifest commit in kubernetes-data.

### 2.5 Service

```yaml
# apps/room-connect/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: room-connect
spec:
  selector:
    app: room-connect
  ports:
    - port: 80
      targetPort: 8080
```

### 2.6 Ingress (ALB)

```yaml
# apps/room-connect/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: room-connect
  annotations:
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP":80}, {"HTTPS":443}]'
    alb.ingress.kubernetes.io/ssl-redirect: '443'
    alb.ingress.kubernetes.io/healthcheck-path: /api/health
spec:
  ingressClassName: alb
  rules:
    - host: room-connect.data.stability.ai
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: room-connect
                port:
                  number: 80
```

### 2.7 ServiceAccount

```yaml
# configs/room-connect/resources/serviceaccount.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: room-connect
  namespace: data-room-connect
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::009160059619:role/data1-us-west-2-room-connect-irsa
```

Note: An `external-secrets` SA is not needed initially since Room Connect doesn't consume secrets from ASM. Add it later if Okta OIDC or DB credentials are needed.

## Phase 3: Initial Image Push

After the terraform-infra PR merges and the ECR repo exists:

### 3.1 Tag initial release

```bash
git tag -a v0.0.0 -m "Initial release"
git push origin v0.0.0
```

### 3.2 Build and push manually

```bash
aws sso login --profile vlad-data-eks
make docker-build IMAGE_TAG=0.1.0
make docker-push IMAGE_TAG=0.1.0
```

### 3.3 Verify image in ECR

```bash
aws ecr describe-images \
  --repository-name stability/room-connect-ecr \
  --region us-west-2 \
  --profile vlad-data-eks \
  --query 'imageDetails[*].{Tag:imageTags,Pushed:imagePushedAt}' \
  --output table
```

## Phase 4: Deploy and Verify

### 4.1 Merge the kubernetes-data PR

ArgoCD picks it up within ~3 minutes. First deploy may take 5-10 minutes due to:
- Karpenter provisioning a GPU node (~5 min cold start)
- DNS propagation via Route 53

### 4.2 Verify deployment

```bash
# ArgoCD synced?
argocd app get room-connect

# Pod running?
kubectl get pods -n data-room-connect

# GPU allocated?
kubectl describe pod -n data-room-connect -l app=room-connect | grep nvidia

# Health endpoint?
kubectl port-forward svc/room-connect -n data-room-connect 8080:80
curl http://localhost:8080/api/health

# GPU visible inside the container?
kubectl exec -n data-room-connect deploy/room-connect -- nvidia-smi
```

### 4.3 Frontend verification

| Check | How | Expected |
|-------|-----|----------|
| App loads | Navigate to `room-connect.data.stability.ai` | React UI renders |
| GLB loading | Click "Load Scene", select a test GLB | Scene appears in viewport |
| Rendering | Place a camera, click "Render" | SSE logs stream, GPU active in `nvidia-smi` |

### 4.4 Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Pod stuck `Pending` | nodeSelector doesn't match any Karpenter pool, or GPU taint not tolerated | Check `kubectl describe pod` events. Verify both tolerations present. |
| Pod `CrashLoopBackOff` | Missing bpy system libraries in production Dockerfile | Check `kubectl logs`. See Phase 0. |
| Render falls back to CPU | NVIDIA device plugin not running or container can't see GPU | `kubectl exec -- nvidia-smi`. Check `kubectl get ds -A \| grep nvidia`. |
| DNS `NXDOMAIN` | Route 53 record not created yet, or ALB not provisioned | Check `kubectl get ingress -n data-room-connect` for ALB address. |
| Large GLB upload timeout | Gunicorn timeout too low | Ensure `--timeout 600` in Dockerfile CMD. |

## Phase 5: Verify CI/CD End-to-End

### 5.1 Pipeline flow

```
feat branch -> PR -> on_pr.yaml: lint + build + push pr-<num>-<sha> to ECR
merge to main -> on_merge.yaml: semantic-release tags vX.Y.Z + push to ECR
```

### 5.2 Test with a small change

1. Create a feature branch, make a visible change (e.g., update app title)
2. Open a PR -- verify `on_pr.yaml` runs and pushes `pr-<num>-<sha>` image
3. Merge with `feat:` prefix commit -- verify `on_merge.yaml` creates tag and pushes versioned image

### 5.3 Roll out to K8s

Update the image tag in `kubernetes-data/apps/room-connect/deployment.yaml`:

```yaml
image: 009160059619.dkr.ecr.us-west-2.amazonaws.com/stability/room-connect-ecr:0.2.0
```

Commit, push, merge. ArgoCD syncs the new image within ~3 min. Verify:

```bash
argocd app get room-connect
kubectl get pods -n data-room-connect
kubectl describe pod -n data-room-connect -l app=room-connect | grep "Image:"
```

**Rollback:** Revert the manifest commit in kubernetes-data. ArgoCD auto-syncs back.

### 5.4 Future: Automated image tag bumps

Currently the image tag in kubernetes-data must be updated manually after each release. To automate, consider:
- A GitHub Actions step in `on_merge.yaml` that opens a PR to kubernetes-data bumping the tag
- Argo CD Image Updater (watches ECR for new tags matching a pattern)
- Renovate bot with ECR datasource

## What Changed from the Original POR

The original POR assumed ad-hoc infrastructure (manual `aws eks create-nodegroup`, `kubectl apply -f k8s/` from the app repo, `make k8s-restart`). After reviewing the company wiki, the approach has been corrected to:

| Original approach | Corrected approach |
|---|---|
| Manual ECR repo creation via CLI | terraform-infra PR |
| Static EKS managed node groups | Karpenter `data-gpu-g6g7` pool (already exists) |
| Manual `nvidia-device-plugin` install | Already deployed via kubernetes-infra (since 2026-05-26) |
| K8s manifests in the app repo (`k8s/`) | Manifests in `kubernetes-data` GitOps repo |
| `kubectl apply -f k8s/` | ArgoCD ApplicationSet auto-sync |
| `make k8s-restart` for rollouts | Update image tag in kubernetes-data, ArgoCD syncs |
| `:latest` tag in prod | Pinned version tags (`:0.1.0`, `:0.2.0`, etc.) |
| No IRSA | IRSA role via terraform-infra |
| No namespace convention | `data-room-connect` namespace |

## About DataEngineeringEKSAdmin

The `DataEngineeringEKSAdmin` SSO role provides kubectl/EKS admin access to the data account (`009160059619`). It is the correct role for:
- Running `kubectl` commands against `data1-us-west-2`
- Inspecting pods, logs, services
- Port-forwarding for testing
- Running `argocd` CLI commands

It does **not** have permissions for:
- `ecr:CreateRepository` (use terraform-infra)
- Terraform plan/apply (use the `tf` SSO profile)
- IAM role creation (use terraform-infra)

This aligns with the company's separation of concerns: infrastructure changes go through Terraform CI, cluster state goes through ArgoCD GitOps, and the EKS admin role is for operational access.

## Summary of Required Actions

| Step | Action | Repo | Owner |
|------|--------|------|-------|
| 0 | Update production Dockerfile with bpy deps + GPU support | room-connect-ecr | Dev team |
| 1a | Create ECR repo `stability/room-connect-ecr` | terraform-infra | Dev team (PR) |
| 1b | Create IRSA role `data1-us-west-2-room-connect-irsa` | terraform-infra | Dev team (PR) |
| 1c | Add repo to GitHubOIDCRole allowlist | terraform-infra | Dev team (PR) |
| 1d | Create Route 53 A record | terraform-infra | Dev team (PR, after ALB exists) |
| 2a | Create ArgoCD ApplicationSet | kubernetes-data | Dev team (PR) |
| 2b | Create Kustomize manifests (deployment, service, ingress) | kubernetes-data | Dev team (PR) |
| 3 | Tag v0.0.0, build and push initial image | room-connect-ecr | Dev team |
| 4 | Verify deployment, GPU, health, frontend | - | Dev team |
| 5 | Test CI/CD end-to-end with a PR + merge | room-connect-ecr + kubernetes-data | Dev team |

No SRE involvement needed unless Okta OIDC auth is required (not initially). GPU infrastructure (Karpenter pool, NVIDIA device plugin, EC2NodeClass) is already operational on the data cluster.
