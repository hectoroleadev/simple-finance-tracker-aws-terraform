

module "database" {
  source = "./modules/database"
  
  project_name = var.project_name
}

module "backend" {
  source = "./modules/backend"

  project_name       = var.project_name
  finance_items_table_name   = module.database.finance_items_table_name
  finance_items_table_arn    = module.database.finance_items_table_arn
  finance_history_table_name = module.database.finance_history_table_name
  finance_history_table_arn  = module.database.finance_history_table_arn
}
