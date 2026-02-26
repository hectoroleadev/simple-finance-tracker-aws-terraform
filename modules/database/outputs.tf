output "finance_items_table_name" {
  value = aws_dynamodb_table.finance_items.name
}

output "finance_items_table_arn" {
  value = aws_dynamodb_table.finance_items.arn
}

output "finance_history_table_name" {
  value = aws_dynamodb_table.finance_history.name
}

output "finance_history_table_arn" {
  value = aws_dynamodb_table.finance_history.arn
}

output "finance_items_stream_arn" {
  value = aws_dynamodb_table.finance_items.stream_arn
}

output "finance_item_history_table_name" {
  value = aws_dynamodb_table.finance_item_history.name
}

output "finance_item_history_table_arn" {
  value = aws_dynamodb_table.finance_item_history.arn
}
