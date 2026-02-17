output "user_pool_id" {
  description = "The ID of the Cognito User Pool."
  value       = aws_cognito_user_pool.user_pool.id
}

output "user_pool_client_id" {
  description = "The ID of the Cognito User Pool Client."
  value       = aws_cognito_user_pool_client.user_pool_client.id
}

output "identity_pool_id" {
  description = "The ID of the Cognito Identity Pool."
  value       = aws_cognito_identity_pool.identity_pool.id
}

output "identity_pool_provider_name" {
  description = "The provider name for the Cognito Identity Pool."
  value       = replace(aws_cognito_user_pool.user_pool.endpoint, "https://", "")
}
