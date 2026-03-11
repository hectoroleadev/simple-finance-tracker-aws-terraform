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

variable "finance_items_stream_arn" {
  type = string
}

variable "finance_item_history_table_name" {
  type = string
}

variable "finance_item_history_table_arn" {
  type = string
}

variable "finance_categories_table_name" {
  type = string
}

variable "finance_categories_table_arn" {
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

variable "api_domain_name" {
  description = "The custom domain name for the API Gateway."
  type        = string
}

variable "user_shares_table_name" {
  type = string
}

variable "user_shares_table_arn" {
  type = string
}
