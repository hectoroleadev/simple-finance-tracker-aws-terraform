
# Cognito User Pool
resource "aws_cognito_user_pool" "user_pool" {
  name = "${var.project_name}-user-pool"

  auto_verified_attributes = ["email"]

  schema {
    name     = "email"
    required = true
    mutable  = true
    attribute_data_type = "String"
  }

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = true
    require_uppercase = true
  }

  # Add other user pool settings as needed, e.g., MfaConfiguration, AccountRecoverySetting
}

# Cognito User Pool Client
resource "aws_cognito_user_pool_client" "user_pool_client" {
  name         = "${var.project_name}-user-pool-client"
  user_pool_id = aws_cognito_user_pool.user_pool.id
  explicit_auth_flows = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"]
}

# Cognito Identity Pool
resource "aws_cognito_identity_pool" "identity_pool" {
  identity_pool_name               = "${var.project_name}-identity-pool"
  allow_unauthenticated_identities = false # Set to true if you need unauthenticated access

  cognito_identity_providers {
    client_id              = aws_cognito_user_pool_client.user_pool_client.id
    provider_name          = replace(aws_cognito_user_pool.user_pool.endpoint, "https://", "")
    server_side_token_check = false
  }
}

# IAM role for authenticated users
resource "aws_iam_role" "cognito_auth_role" {
  name = "${var.project_name}-cognito-auth-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = "cognito-identity.amazonaws.com"
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "cognito-identity.amazonaws.com:aud" = aws_cognito_identity_pool.identity_pool.id
          }
          "ForAnyValue:StringLike" = {
            "cognito-identity.amazonaws.com:amr" = "authenticated"
          }
        }
      }
    ]
  })
}

# IAM role for unauthenticated users (though not currently allowed by identity_pool)
resource "aws_iam_role" "cognito_unauth_role" {
  name = "${var.project_name}-cognito-unauth-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = "cognito-identity.amazonaws.com"
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "cognito-identity.amazonaws.com:aud" = aws_cognito_identity_pool.identity_pool.id
          }
          "ForAnyValue:StringLike" = {
            "cognito-identity.amazonaws.com:amr" = "unauthenticated"
          }
        }
      }
    ]
  })
}

# Attach the roles to the Identity Pool
resource "aws_cognito_identity_pool_roles_attachment" "main" {
  identity_pool_id = aws_cognito_identity_pool.identity_pool.id

  roles = {
    "authenticated"   = aws_iam_role.cognito_auth_role.arn
    "unauthenticated" = aws_iam_role.cognito_unauth_role.arn
  }
}

# IAM policy for authenticated users to access DynamoDB (read-only)
resource "aws_iam_policy" "cognito_auth_dynamodb_readonly_policy" {
  name        = "${var.project_name}-cognito-auth-dynamodb-readonly-policy"
  description = "IAM policy for Cognito authenticated users to read from Finance DynamoDB tables"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "dynamodb:BatchGetItem",
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Effect   = "Allow"
        Resource = [
            var.finance_items_table_arn,
            var.finance_history_table_arn
        ]
      },
      {
        Action = [
            "mobileanalytics:PutEvents",
            "cognito-sync:*"
        ]
        Effect = "Allow"
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "cognito_auth_dynamodb_readonly_attachment" {
  role       = aws_iam_role.cognito_auth_role.name
  policy_arn = aws_iam_policy.cognito_auth_dynamodb_readonly_policy.arn
}

