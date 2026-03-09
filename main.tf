

module "database" {
  source = "./modules/database"

  project_name = var.project_name
}

module "backend" {
  source = "./modules/backend"

  project_name                    = var.project_name
  finance_items_table_name        = module.database.finance_items_table_name
  finance_items_table_arn         = module.database.finance_items_table_arn
  finance_history_table_name      = module.database.finance_history_table_name
  finance_history_table_arn       = module.database.finance_history_table_arn
  finance_items_stream_arn        = module.database.finance_items_stream_arn
  finance_item_history_table_name = module.database.finance_item_history_table_name
  finance_item_history_table_arn  = module.database.finance_item_history_table_arn
  finance_categories_table_name   = module.database.finance_categories_table_name
  finance_categories_table_arn    = module.database.finance_categories_table_arn
  user_pool_id                    = module.auth.user_pool_id
  user_pool_client_id             = module.auth.user_pool_client_id
  aws_region                      = var.aws_region
  api_domain_name                 = var.api_domain_name
}

module "auth" {
  source = "./modules/auth"

  project_name              = var.project_name
  finance_items_table_arn   = module.database.finance_items_table_arn
  finance_history_table_arn = module.database.finance_history_table_arn
}
