resource "aws_dynamodb_table" "finance_items" {
  name           = "${var.project_name}-items"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "id"

  attribute {
    name = "id"
    type = "S"
  }

  tags = {
    Name        = "${var.project_name}-items"
    Environment = "production"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_dynamodb_table" "finance_history" {
  name           = "${var.project_name}-history"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "id"

  attribute {
    name = "id"
    type = "S"
  }

  tags = {
    Name        = "${var.project_name}-history"
    Environment = "production"
  }

  lifecycle {
    prevent_destroy = true
  }
}
