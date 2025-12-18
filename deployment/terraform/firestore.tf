resource "google_firestore_database" "default" {
  for_each           = local.deploy_project_ids
  project            = each.value
  name               = "(default)"
  location_id        = var.region
  type               = "FIRESTORE_NATIVE"
  concurrency_mode   = "OPTIMISTIC"
  deletion_policy    = "DELETE"
}

resource "google_discovery_engine_data_store" "file_search" {
  for_each      = local.deploy_project_ids
  project       = each.value
  location      = var.region
  data_store_id = "${var.project_name}-file-search"
  display_name  = "${var.project_name}-file-search"

  industry_vertical = "GENERIC"
  solution_types    = ["SOLUTION_TYPE_SEARCH"]
  content_config    = "CONTENT_REQUIRED"
}


