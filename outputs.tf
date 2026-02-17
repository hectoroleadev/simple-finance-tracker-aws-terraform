output "api_gateway_url" {
  description = "URL of the API Gateway"
  value       = module.backend.api_gateway_url
}

output "api_key_value" {
  value     = module.backend.api_key_value
  sensitive = true
}

output "user_pool_id" {
  description = "The ID of the Cognito User Pool."
  value       = module.auth.user_pool_id
}

output "user_pool_client_id" {
  description = "The ID of the Cognito User Pool Client."
  value       = module.auth.user_pool_client_id
}

output "identity_pool_id" {
  description = "The ID of the Cognito Identity Pool."
  value       = module.auth.identity_pool_id
}

output "finance_items_table_name" {
  description = "The name of the finance items DynamoDB table."
  value       = module.database.finance_items_table_name
}

output "finance_history_table_name" {
  description = "The name of the finance history DynamoDB table."
  value       = module.database.finance_history_table_name
}
