output "api_gateway_url" {
  value = aws_api_gateway_stage.api.invoke_url
}

output "acm_validation_options" {
  description = "DNS validation records for the ACM certificate"
  value       = aws_acm_certificate.api_cert.domain_validation_options
}

output "api_gateway_regional_domain_name" {
  description = "The target regional domain name for the API Gateway"
  value       = aws_api_gateway_domain_name.api_custom_domain.regional_domain_name
}
