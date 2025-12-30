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

# Composite indexes for videos collection - required for sorted channel queries
# These indexes enable efficient queries like "most popular videos from channel X"

resource "google_firestore_index" "videos_channel_view_count" {
  for_each   = local.deploy_project_ids
  project    = each.value
  database   = google_firestore_database.default[each.key].name
  collection = "videos"

  fields {
    field_path = "channel_id"
    order      = "ASCENDING"
  }

  fields {
    field_path = "view_count"
    order      = "DESCENDING"
  }
}

resource "google_firestore_index" "videos_channel_published_at" {
  for_each   = local.deploy_project_ids
  project    = each.value
  database   = google_firestore_database.default[each.key].name
  collection = "videos"

  fields {
    field_path = "channel_id"
    order      = "ASCENDING"
  }

  fields {
    field_path = "published_at"
    order      = "DESCENDING"
  }
}

resource "google_firestore_index" "videos_channel_like_count" {
  for_each   = local.deploy_project_ids
  project    = each.value
  database   = google_firestore_database.default[each.key].name
  collection = "videos"

  fields {
    field_path = "channel_id"
    order      = "ASCENDING"
  }

  fields {
    field_path = "like_count"
    order      = "DESCENDING"
  }
}



