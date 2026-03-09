resource "aws_dynamodb_table" "finance_items" {
  name         = "${var.project_name}-items"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  tags = {
    Name        = "${var.project_name}-items"
    Environment = "production"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_dynamodb_table" "finance_history" {
  name         = "${var.project_name}-history"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

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

resource "aws_dynamodb_table" "finance_item_history" {
  name         = "${var.project_name}-item-history"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "itemId"
  range_key    = "timestamp"

  attribute {
    name = "itemId"
    type = "S"
  }

  attribute {
    name = "timestamp"
    type = "S"
  }

  tags = {
    Name        = "${var.project_name}-item-history"
    Environment = "production"
  }
}

resource "aws_dynamodb_table" "finance_categories" {
  name         = "${var.project_name}-categories"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  tags = {
    Name        = "${var.project_name}-categories"
    Environment = "production"
  }

  lifecycle {
    prevent_destroy = true
  }
}
