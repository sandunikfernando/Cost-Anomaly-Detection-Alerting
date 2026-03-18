#!/bin/bash
# Creates multiple PostgreSQL databases on first container boot.
# Called automatically by the postgres Docker image from /docker-entrypoint-initdb.d/

set -e

# POSTGRES_MULTIPLE_DATABASES format: "db1:user1:pass1,db2:user2:pass2"
IFS=',' read -ra DBS <<< "$POSTGRES_MULTIPLE_DATABASES"

for entry in "${DBS[@]}"; do
  IFS=':' read -r db user pass <<< "$entry"
  echo "Creating database '$db' with user '$user'..."

  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    CREATE USER ${user} WITH PASSWORD '${pass}';
    CREATE DATABASE ${db} OWNER ${user};
    GRANT ALL PRIVILEGES ON DATABASE ${db} TO ${user};
EOSQL

  echo "Database '$db' created."
done

# Apply the application schema to finops_db
echo "Applying FinOps schema to finops_db..."
psql -v ON_ERROR_STOP=1 --username "finops_user" --dbname "finops_db" -f /schema.sql
echo "Schema applied successfully."
