# IAM Role for Lambda
resource "aws_iam_role" "lambda_role" {
  name = "${var.project_name}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

# IAM Policy for DynamoDB Access
resource "aws_iam_policy" "dynamodb_access" {
  name        = "${var.project_name}-dynamodb-policy"
  description = "IAM policy for accessing Finance DynamoDB tables"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Scan",
          "dynamodb:Query",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem"
        ]
        Effect   = "Allow"
        Resource = [
            var.finance_items_table_arn,
            var.finance_history_table_arn,
            var.finance_item_history_table_arn,
            var.finance_categories_table_arn
        ]
      },
      {
        Action = [
          "dynamodb:DescribeStream",
          "dynamodb:GetRecords",
          "dynamodb:GetShardIterator",
          "dynamodb:ListStreams"
        ]
        Effect   = "Allow"
        Resource = var.finance_items_stream_arn
      },
      {
        Action = [
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
            "logs:PutLogEvents"
        ]
        Effect = "Allow"
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = aws_iam_policy.dynamodb_access.arn
}

# Zip the lambda code
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../../src/lambda"
  output_path = "${path.module}/lambda_function.zip"
}

# Lambda Function
resource "aws_lambda_function" "api_lambda" {
  filename      = data.archive_file.lambda_zip.output_path
  function_name = "${var.project_name}-api"
  role          = aws_iam_role.lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  timeout       = 10


  environment {
    variables = {
      ITEMS_TABLE_NAME        = var.finance_items_table_name
      HISTORY_TABLE_NAME      = var.finance_history_table_name
      ITEM_HISTORY_TABLE_NAME = var.finance_item_history_table_name
      CATEGORIES_TABLE_NAME   = var.finance_categories_table_name
    }
  }
}

# History Processor Lambda
resource "aws_lambda_function" "history_processor" {
  filename      = data.archive_file.lambda_zip.output_path
  function_name = "${var.project_name}-history-processor"
  role          = aws_iam_role.lambda_role.arn
  handler       = "history_processor.handler"
  runtime       = "nodejs20.x"
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  timeout       = 30

  environment {
    variables = {
      ITEM_HISTORY_TABLE_NAME = var.finance_item_history_table_name
    }
  }
}

# DynamoDB Stream Event Source Mapping
resource "aws_lambda_event_source_mapping" "item_history" {
  event_source_arn  = var.finance_items_stream_arn
  function_name     = aws_lambda_function.history_processor.arn
  starting_position = "LATEST"
  batch_size        = 10
}

# API Gateway (REST API)
resource "aws_api_gateway_rest_api" "api" {
  name = "${var.project_name}-api"
}

data "aws_caller_identity" "current" {}

# Cognito Authorizer
resource "aws_api_gateway_authorizer" "cognito_authorizer" {
  name                   = "${var.project_name}-cognito-authorizer"
  rest_api_id            = aws_api_gateway_rest_api.api.id
  type                   = "COGNITO_USER_POOLS"
  identity_source        = "method.request.header.Authorization"
  provider_arns          = [
    "arn:aws:cognito-idp:${var.aws_region}:${data.aws_caller_identity.current.account_id}:userpool/${var.user_pool_id}"
  ]
}

resource "aws_api_gateway_resource" "proxy" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "proxy_get" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.proxy.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS" # Use Cognito Authorizer
  authorizer_id = aws_api_gateway_authorizer.cognito_authorizer.id
  api_key_required = false # No API key needed with Cognito Auth
}

resource "aws_api_gateway_integration" "lambda_get" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_method.proxy_get.resource_id
  http_method = aws_api_gateway_method.proxy_get.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.api_lambda.invoke_arn
}

resource "aws_api_gateway_method" "proxy_post" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.proxy.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS" # Use Cognito Authorizer
  authorizer_id = aws_api_gateway_authorizer.cognito_authorizer.id
  api_key_required = false # No API key needed with Cognito Auth
}

resource "aws_api_gateway_integration" "lambda_post" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_method.proxy_post.resource_id
  http_method = aws_api_gateway_method.proxy_post.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.api_lambda.invoke_arn
}

resource "aws_api_gateway_method" "proxy_delete" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.proxy.id
  http_method   = "DELETE"
  authorization = "COGNITO_USER_POOLS" # Use Cognito Authorizer
  authorizer_id = aws_api_gateway_authorizer.cognito_authorizer.id
  api_key_required = false # No API key needed with Cognito Auth
}

resource "aws_api_gateway_integration" "lambda_delete" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_method.proxy_delete.resource_id
  http_method = aws_api_gateway_method.proxy_delete.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.api_lambda.invoke_arn
}

resource "aws_api_gateway_method" "proxy_root" {
   rest_api_id   = aws_api_gateway_rest_api.api.id
   resource_id   = aws_api_gateway_rest_api.api.root_resource_id
   http_method   = "ANY"
   authorization = "COGNITO_USER_POOLS" # Use Cognito Authorizer
   authorizer_id = aws_api_gateway_authorizer.cognito_authorizer.id
   api_key_required = false # No API key needed with Cognito Auth
}

resource "aws_api_gateway_integration" "lambda_root" {
   rest_api_id = aws_api_gateway_rest_api.api.id
   resource_id = aws_api_gateway_method.proxy_root.resource_id
   http_method = aws_api_gateway_method.proxy_root.http_method

   integration_http_method = "POST"
   type                    = "AWS_PROXY"
   uri                     = aws_lambda_function.api_lambda.invoke_arn
}

# CORS for /{proxy+} resource
resource "aws_api_gateway_method" "proxy_options" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.proxy.id
  http_method   = "OPTIONS"
  authorization = "NONE"
  api_key_required = false # Crucial for preflight requests
}

resource "aws_api_gateway_integration" "proxy_options_integration" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.proxy.id
  http_method = aws_api_gateway_method.proxy_options.http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "proxy_options_response" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.proxy.id
  http_method = aws_api_gateway_method.proxy_options.http_method
  status_code = "200"
  response_models = {
    "application/json" = "Empty"
    
  }
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true,
    "method.response.header.Access-Control-Allow-Methods" = true,
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "proxy_options_integration_response" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.proxy.id
  http_method = aws_api_gateway_method.proxy_options.http_method
  status_code = aws_api_gateway_method_response.proxy_options_response.status_code

  response_templates = {
    "application/json" = ""
  }
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
    "method.response.header.Access-Control-Allow-Methods" = "'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT'",
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  depends_on = [aws_api_gateway_integration.proxy_options_integration]
}

resource "aws_api_gateway_deployment" "api" {
  depends_on = [
    aws_api_gateway_integration.lambda_get,
    aws_api_gateway_integration.lambda_post,
    aws_api_gateway_integration.lambda_delete,
    aws_api_gateway_integration.lambda_root,
    aws_api_gateway_integration.proxy_options_integration
  ]

  rest_api_id = aws_api_gateway_rest_api.api.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_method.proxy_get,
      aws_api_gateway_integration.lambda_get,
      aws_api_gateway_method.proxy_post,
      aws_api_gateway_integration.lambda_post,
      aws_api_gateway_method.proxy_delete,
      aws_api_gateway_integration.lambda_delete,
      aws_api_gateway_method.proxy_root,
      aws_api_gateway_integration.lambda_root,
      aws_api_gateway_method.proxy_options,
      aws_api_gateway_integration.proxy_options_integration,
      aws_api_gateway_method_response.proxy_options_response,
      aws_api_gateway_integration_response.proxy_options_integration_response,
    ]))
  }

  # NOTE: The description is required to force a new deployment if there are only changes
  # to the stage configuration (e.g., variable changes) and no changes to the methods/integrations
  # above. This ensures the API is actually redeployed with the latest configuration.
  description = "Managed by Terraform"

  lifecycle {
    create_before_destroy = true
  }
}



resource "aws_api_gateway_stage" "api" {
  deployment_id = aws_api_gateway_deployment.api.id
  rest_api_id   = aws_api_gateway_rest_api.api.id
  stage_name    = "prod"

  lifecycle {
    create_before_destroy = true
  }
}


# The API Key and Usage Plan are no longer required for authenticated endpoints,
# but can be kept for unauthenticated ones if needed, or removed entirely if all
# endpoints are now secured by Cognito. Given that auth/signup and auth/login
# do not require API keys, these resources can likely be removed.
resource "aws_api_gateway_api_key" "main" {
  name = "${var.project_name}-key"
}

resource "aws_api_gateway_usage_plan" "main" {
  name = "${var.project_name}-usage-plan"

  api_stages {
    api_id = aws_api_gateway_rest_api.api.id
    stage  = aws_api_gateway_stage.api.stage_name
  }
}

resource "aws_api_gateway_usage_plan_key" "main" {
  key_id        = aws_api_gateway_api_key.main.id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.main.id
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/*/*"
}

output "api_key_value" {
  value = aws_api_gateway_api_key.main.value
}

