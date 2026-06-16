SHELL := /bin/bash

# Project Variables
REPO_NAME := room-connect-ecr
ECR_REPO_NAME := stability/room-connect-ecr
AWS_REGION := us-west-2
AWS_ACCOUNT := 009160059619

# Docker Variables
ECR_REGISTRY ?= $(AWS_ACCOUNT).dkr.ecr.$(AWS_REGION).amazonaws.com
IMAGE_TAG ?= latest
DOCKER_IMAGE := $(ECR_REGISTRY)/$(ECR_REPO_NAME):$(IMAGE_TAG)

###########################
# Development             #
###########################

## Start dev environment (frontend + backend via docker-compose)
.PHONY: dev
dev:
	@echo "Starting development environment..."
	@docker-compose up --build

## Start dev environment in background
.PHONY: dev-detach
dev-detach:
	@echo "Starting development environment (detached)..."
	@docker-compose up --build -d

## Stop dev environment
.PHONY: dev-stop
dev-stop:
	@echo "Stopping development environment..."
	@docker-compose down

## Run pre-commit hooks on all files
.PHONY: lint
lint:
	@echo "Running pre-commit hooks..."
	@pre-commit run --all-files

###########################
# Docker / ECR            #
###########################

## Build production Docker image
.PHONY: docker-build
docker-build:
	@echo "Building Docker image: $(DOCKER_IMAGE)..."
	@docker build -t $(DOCKER_IMAGE) -f Dockerfile .
	@echo "Docker image built: $(DOCKER_IMAGE)"

## Login to ECR
.PHONY: ecr-login
ecr-login:
	@echo "Logging in to ECR..."
	@aws ecr get-login-password --region $(AWS_REGION) | \
		docker login --username AWS --password-stdin $(ECR_REGISTRY)
	@echo "ECR login successful"

## Push Docker image to ECR
.PHONY: docker-push
docker-push: docker-build ecr-login
	@echo "Pushing Docker image to ECR..."
	@docker push $(DOCKER_IMAGE)
	@echo "Pushed: $(DOCKER_IMAGE)"

## Run production container locally
.PHONY: docker-run
docker-run: docker-build
	@echo "Running container locally on :8080..."
	@docker run -d --name $(REPO_NAME) -p 8080:8080 \
		-e UPLOAD_DIR=/tmp/room-connect-uploads \
		$(DOCKER_IMAGE)
	@echo "Container '$(REPO_NAME)' running at http://localhost:8080"

## Stop and remove local container
.PHONY: docker-stop
docker-stop:
	@echo "Stopping container..."
	@docker stop $(REPO_NAME) 2>/dev/null || echo "Container not running"
	@docker rm $(REPO_NAME) 2>/dev/null || echo "Container already removed"
	@echo "Container cleanup complete"

## Remove all Docker artifacts for this project
.PHONY: docker-clean
docker-clean: docker-stop
	@echo "Cleaning Docker images..."
	@docker rmi $(DOCKER_IMAGE) 2>/dev/null || echo "Image not found"
	@echo "Docker cleanup complete"

###########################
# Kubernetes              #
###########################

## Apply Kubernetes manifests
.PHONY: k8s-apply
k8s-apply:
	@echo "Applying Kubernetes manifests..."
	@kubectl apply -f k8s/
	@echo "Manifests applied"

## Delete Kubernetes resources
.PHONY: k8s-delete
k8s-delete:
	@echo "Deleting Kubernetes resources..."
	@kubectl delete -f k8s/
	@echo "Resources deleted"

## Restart the K8s deployment (triggers image pull)
.PHONY: k8s-restart
k8s-restart:
	@echo "Restarting deployment..."
	@kubectl rollout restart deployment/$(REPO_NAME)
	@kubectl rollout status deployment/$(REPO_NAME)

###########################
# Utilities               #
###########################

## Show project and ECR configuration
.PHONY: info
info:
	@echo "Project Information:"
	@echo "  Repository:    $(REPO_NAME)"
	@echo "  ECR Image:     $(DOCKER_IMAGE)"
	@echo "  ECR Registry:  $(ECR_REGISTRY)"
	@echo "  ECR Repo:      $(ECR_REPO_NAME)"
	@echo "  AWS Region:    $(AWS_REGION)"
	@echo "  AWS Account:   $(AWS_ACCOUNT)"

## Show available targets
.PHONY: help
help:
	@echo "Available targets:"
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /'
