variable "project_name" {
  description = "The name of the project, used as a prefix for resource names."
  type        = string
}

variable "finance_items_table_arn" {
  description = "The ARN of the finance items DynamoDB table."
  type        = string
}

variable "finance_history_table_arn" {
  description = "The ARN of the finance history DynamoDB table."
  type        = string
}
