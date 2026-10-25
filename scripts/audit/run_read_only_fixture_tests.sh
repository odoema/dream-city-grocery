#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQL_FILE="$ROOT_DIR/scripts/audit/read_only_baseline.sql"
ARTIFACT_DIR="${ARTIFACT_DIR:-$ROOT_DIR/artifacts/read-only-fixture}"
mkdir -p "$ARTIFACT_DIR"

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGDATABASE:=postgres}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:=postgres}"
export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD

ADMIN=(psql --no-psqlrc --set=ON_ERROR_STOP=1)
AUDIT=(env PGPASSWORD=audit_runner_password psql --no-psqlrc --set=ON_ERROR_STOP=1 --username=audit_runner)

log() { printf '\n== %s ==\n' "$1"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

setup_fixture() {
  "${ADMIN[@]}" <<'SQL'
DROP ROLE IF EXISTS audit_runner;
CREATE ROLE audit_runner LOGIN PASSWORD 'audit_runner_password';

DROP FUNCTION IF EXISTS public.search_dream_city_products(text, integer);
DROP FUNCTION IF EXISTS public.search_dream_city_products(text);

DROP TABLE IF EXISTS public.products, public.categories, public.suppliers,
  public.inventory_movements, public.sales, public.sale_items,
  public.purchase_orders, public.goods_receipts, public.journals,
  public.journal_lines, public.audit_log CASCADE;

CREATE TABLE public.products (id integer PRIMARY KEY, fixture_value text NOT NULL);
CREATE TABLE public.categories (id integer PRIMARY KEY, fixture_value text NOT NULL);
CREATE TABLE public.suppliers (id integer PRIMARY KEY, fixture_value text NOT NULL);
CREATE TABLE public.inventory_movements (id integer PRIMARY KEY, fixture_value text NOT NULL);
CREATE TABLE public.sales (id integer PRIMARY KEY, fixture_value text NOT NULL);
CREATE TABLE public.sale_items (id integer PRIMARY KEY, fixture_value text NOT NULL);
CREATE TABLE public.purchase_orders (id integer PRIMARY KEY, fixture_value text NOT NULL);
CREATE TABLE public.goods_receipts (id integer PRIMARY KEY, fixture_value text NOT NULL);
CREATE TABLE public.journals (id integer PRIMARY KEY, fixture_value text NOT NULL);
CREATE TABLE public.journal_lines (id integer PRIMARY KEY, fixture_value text NOT NULL);
CREATE TABLE public.audit_log (id integer PRIMARY KEY, fixture_value text NOT NULL);

INSERT INTO public.products VALUES (1, 'fixture'), (2, 'fixture');
INSERT INTO public.categories VALUES (1, 'fixture'), (2, 'fixture');
INSERT INTO public.suppliers VALUES (1, 'fixture'), (2, 'fixture');
INSERT INTO public.inventory_movements VALUES (1, 'fixture'), (2, 'fixture');
INSERT INTO public.sales VALUES (1, 'fixture'), (2, 'fixture');
INSERT INTO public.sale_items VALUES (1, 'fixture'), (2, 'fixture');
INSERT INTO public.purchase_orders VALUES (1, 'fixture'), (2, 'fixture');
INSERT INTO public.goods_receipts VALUES (1, 'fixture'), (2, 'fixture');
INSERT INTO public.journals VALUES (1, 'fixture'), (2, 'fixture');
INSERT INTO public.journal_lines VALUES (1, 'fixture'), (2, 'fixture');
INSERT INTO public.audit_log VALUES (1, 'fixture'), (2, 'fixture');

CREATE FUNCTION public.search_dream_city_products(text, integer)
RETURNS text
LANGUAGE sql
AS $$ SELECT 'fixture'; $$;

GRANT USAGE ON SCHEMA public TO audit_runner;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO audit_runner;
SQL
}

run_baseline() {
  local output_file="$1"
  "${AUDIT[@]}" --file="$SQL_FILE" >"$output_file" 2>&1
}

expect_failure() {
  local name="$1"
  local expected="$2"
  local output_file="$ARTIFACT_DIR/${name}.log"
  shift 2

  log "$name"
  set +e
  "$@" >"$output_file" 2>&1
  local status=$?
  set -e

  cat "$output_file"
  [[ $status -ne 0 ]] || fail "$name unexpectedly succeeded"
  grep -Fq "$expected" "$output_file" || fail "$name did not contain expected diagnostic: $expected"
  echo "PASS: non-zero exit and expected diagnostic"
}

log "Environment"
psql --version
"${ADMIN[@]}" -Atc "SELECT current_database(), version();" | tee "$ARTIFACT_DIR/environment.txt"

log "1. Happy path"
setup_fixture
happy="$ARTIFACT_DIR/happy-path.log"
run_baseline "$happy"
cat "$happy"
grep -A1 -F "read_only_transaction_verified" "$happy" | grep -Fq "t" || fail "happy path did not verify read-only transaction as true"
grep -Fq "product_intelligence_rpc" "$happy" || fail "happy path missing RPC verification output"
expected_counts='2|2|2|2|2|2|2|2|2|2|2'
actual_counts="$("${AUDIT[@]}" -Atc "SELECT (SELECT count(*) FROM public.products),(SELECT count(*) FROM public.categories),(SELECT count(*) FROM public.suppliers),(SELECT count(*) FROM public.inventory_movements),(SELECT count(*) FROM public.sales),(SELECT count(*) FROM public.sale_items),(SELECT count(*) FROM public.purchase_orders),(SELECT count(*) FROM public.goods_receipts),(SELECT count(*) FROM public.journals),(SELECT count(*) FROM public.journal_lines),(SELECT count(*) FROM public.audit_log);")"
[[ "$actual_counts" == "$expected_counts" ]] || fail "fixture counts changed unexpectedly: $actual_counts"
echo "PASS: baseline completed and all 11 aggregate counts remain 2"

log "2. Missing required table"
setup_fixture
"${ADMIN[@]}" -c "DROP TABLE public.products;"
expect_failure "missing-table" "REQUIRED_OBJECT_MISSING: required relation public.products is absent" bash -c "PGHOST='$PGHOST' PGPORT='$PGPORT' PGDATABASE='$PGDATABASE' PGUSER=audit_runner PGPASSWORD=audit_runner_password psql --no-psqlrc --set=ON_ERROR_STOP=1 --file='$SQL_FILE'"

log "3. Required relation is absent"
setup_fixture
"${ADMIN[@]}" -c "DROP TABLE public.categories;"
expect_failure "missing-relation" "REQUIRED_OBJECT_MISSING: required relation public.categories is absent" bash -c "PGHOST='$PGHOST' PGPORT='$PGPORT' PGDATABASE='$PGDATABASE' PGUSER=audit_runner PGPASSWORD=audit_runner_password psql --no-psqlrc --set=ON_ERROR_STOP=1 --file='$SQL_FILE'"

log "4. Product Intelligence RPC missing"
setup_fixture
"${ADMIN[@]}" -c "DROP FUNCTION public.search_dream_city_products(text, integer);"
expect_failure "missing-rpc" "REQUIRED_OBJECT_MISSING: public.search_dream_city_products(text,integer) is absent" bash -c "PGHOST='$PGHOST' PGPORT='$PGPORT' PGDATABASE='$PGDATABASE' PGUSER=audit_runner PGPASSWORD=audit_runner_password psql --no-psqlrc --set=ON_ERROR_STOP=1 --file='$SQL_FILE'"

log "5. RPC exists with wrong signature"
setup_fixture
"${ADMIN[@]}" -c "DROP FUNCTION public.search_dream_city_products(text, integer); CREATE FUNCTION public.search_dream_city_products(text) RETURNS text LANGUAGE sql AS \$\$ SELECT 'wrong-signature'; \$\$; GRANT EXECUTE ON FUNCTION public.search_dream_city_products(text) TO audit_runner;"
expect_failure "wrong-rpc-signature" "INSUFFICIENT_PRIVILEGE_OR_VISIBILITY: search_dream_city_products exists in public but the expected signature is not visible" bash -c "PGHOST='$PGHOST' PGPORT='$PGPORT' PGDATABASE='$PGDATABASE' PGUSER=audit_runner PGPASSWORD=audit_runner_password psql --no-psqlrc --set=ON_ERROR_STOP=1 --file='$SQL_FILE'"

log "6. Restricted schema visibility / privilege diagnostic"
setup_fixture
"${ADMIN[@]}" -c "REVOKE USAGE ON SCHEMA public FROM audit_runner; REVOKE USAGE ON SCHEMA public FROM PUBLIC;"
expect_failure "restricted-visibility" "INSUFFICIENT_PRIVILEGE_OR_VISIBILITY: required relation public.products exists but is not visible through to_regclass()" bash -c "PGHOST='$PGHOST' PGPORT='$PGPORT' PGDATABASE='$PGDATABASE' PGUSER=audit_runner PGPASSWORD=audit_runner_password psql --no-psqlrc --set=ON_ERROR_STOP=1 --file='$SQL_FILE'"

log "7. Read-only transaction rejects deliberate write"
setup_fixture
before="$("${AUDIT[@]}" -Atc "SELECT count(*) FROM public.products;")"
write_log="$ARTIFACT_DIR/read-only-write.log"
set +e
"${AUDIT[@]}" -c "BEGIN TRANSACTION READ ONLY; INSERT INTO public.products(id, fixture_value) VALUES (999, 'must-not-write');" >"$write_log" 2>&1
write_status=$?
set -e
cat "$write_log"
[[ $write_status -ne 0 ]] || fail "deliberate write unexpectedly succeeded"
grep -Fq "cannot execute INSERT in a read-only transaction" "$write_log" || fail "read-only write rejection diagnostic missing"
after="$("${AUDIT[@]}" -Atc "SELECT count(*) FROM public.products;")"
[[ "$before" == "$after" ]] || fail "fixture changed after rejected write: before=$before after=$after"
echo "PASS: write rejected and fixture remained unchanged"

log "8. Final fixture integrity"
setup_fixture
final_counts="$("${AUDIT[@]}" -Atc "SELECT (SELECT count(*) FROM public.products),(SELECT count(*) FROM public.categories),(SELECT count(*) FROM public.suppliers),(SELECT count(*) FROM public.inventory_movements),(SELECT count(*) FROM public.sales),(SELECT count(*) FROM public.sale_items),(SELECT count(*) FROM public.purchase_orders),(SELECT count(*) FROM public.goods_receipts),(SELECT count(*) FROM public.journals),(SELECT count(*) FROM public.journal_lines),(SELECT count(*) FROM public.audit_log);")"
[[ "$final_counts" == "$expected_counts" ]] || fail "final fixture integrity failed: $final_counts"
echo "PASS: synthetic fixture contains expected unchanged data"

echo "ALL DISPOSABLE READ-ONLY BASELINE TESTS PASSED"
