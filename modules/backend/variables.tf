variable "project_name" {
  type = string
}

variable "finance_items_table_name" {
  type = string
}

variable "finance_items_table_arn" {
  type = string
}

variable "finance_history_table_name" {
    type = string
}

variable "finance_history_table_arn" {
    type = string
}

variable "user_pool_id" {
  description = "The ID of the Cognito User Pool."
  type        = string
}

variable "user_pool_client_id" {
  description = "The ID of the Cognito User Pool Client."
  type        = string
}

variable "aws_region" {
  description = "The AWS region where resources are deployed."
  type        = string
}
