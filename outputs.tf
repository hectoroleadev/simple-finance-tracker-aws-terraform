output "api_gateway_url" {
  description = "URL of the API Gateway"
  value       = module.backend.api_gateway_url
}

output "api_key_value" {
  value     = module.backend.api_key_value
  sensitive = true
}
