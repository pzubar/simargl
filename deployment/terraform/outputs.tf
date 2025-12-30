output "firestore_databases" {
  description = "Firestore databases created per environment."
  value = {
    for k, db in google_firestore_database.default :
    k => {
      name        = db.name
      location_id = db.location_id
    }
  }
}

output "file_search_datastores" {
  description = "Discovery Engine data stores for Gemini File Search per environment."
  value = {
    for k, ds in google_discovery_engine_data_store.file_search :
    k => {
      id           = ds.data_store_id
      name         = ds.name
      location     = ds.location
      display_name = ds.display_name
    }
  }
}



