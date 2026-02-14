variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "mx-central-1"
}

variable "project_name" {
  description = "Project name"
  type        = string
  default     = "simple-finance-tracker"
}
