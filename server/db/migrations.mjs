export function migrate(db) {
  db.pragma('foreign_keys = ON');
  db.exec(`
    create table if not exists schema_migrations (
      version integer primary key,
      applied_at text not null
    );

    create table if not exists admin_users (
      id integer primary key,
      username text unique not null,
      password_hash text not null,
      password_salt text not null,
      created_at text not null,
      last_login_at text
    );

    create table if not exists upstream_keys (
      id integer primary key,
      name text not null,
      encrypted_key_envelope text not null,
      key_fingerprint text unique not null,
      key_preview text not null default '',
      admin_enabled integer not null default 1,
      health_status text not null default 'unknown',
      quota_status text not null default 'unknown',
      quota_total_tokens integer,
      quota_used_tokens integer,
      quota_remaining_tokens integer,
      quota_reset_at text,
      last_quota_checked_at text,
      last_success_at text,
      last_error_at text,
      last_error_message text,
      notes text not null default '',
      created_at text not null,
      updated_at text not null
    );

    create table if not exists proxy_keys (
      id integer primary key,
      name text not null,
      key_hash text unique not null,
      key_prefix text not null,
      status text not null default 'enabled',
      daily_token_limit integer,
      monthly_token_limit integer,
      allowed_models_json text not null default '[]',
      last_used_at text,
      notes text not null default '',
      created_at text not null,
      updated_at text not null
    );

    create table if not exists usage_events_recent (
      request_id text primary key,
      proxy_key_id integer,
      upstream_key_id integer,
      endpoint text not null,
      model text,
      status_code integer,
      success integer not null,
      input_tokens integer not null default 0,
      output_tokens integer not null default 0,
      cached_tokens integer not null default 0,
      duration_ms integer not null default 0,
      error_type text,
      created_at text not null
    );

    create table if not exists usage_hourly (
      bucket_start text not null,
      upstream_key_id integer not null default 0,
      proxy_key_id integer not null default 0,
      model text not null,
      endpoint text not null,
      request_count integer not null default 0,
      success_count integer not null default 0,
      error_count integer not null default 0,
      input_tokens integer not null default 0,
      output_tokens integer not null default 0,
      cached_tokens integer not null default 0,
      total_tokens integer not null default 0,
      avg_duration_ms real not null default 0,
      primary key(bucket_start, upstream_key_id, proxy_key_id, model, endpoint)
    );

    create table if not exists usage_daily (
      bucket_start text not null,
      upstream_key_id integer not null default 0,
      proxy_key_id integer not null default 0,
      model text not null,
      endpoint text not null,
      request_count integer not null default 0,
      success_count integer not null default 0,
      error_count integer not null default 0,
      input_tokens integer not null default 0,
      output_tokens integer not null default 0,
      cached_tokens integer not null default 0,
      total_tokens integer not null default 0,
      avg_duration_ms real not null default 0,
      primary key(bucket_start, upstream_key_id, proxy_key_id, model, endpoint)
    );

    create table if not exists settings (
      key text primary key,
      value text not null,
      updated_at text not null
    );

    create table if not exists routing_state (
      name text primary key,
      cursor_value integer not null default 0,
      updated_at text not null
    );

    create table if not exists usage_reservations (
      request_id text primary key,
      proxy_key_id integer not null,
      reserved_tokens integer not null,
      settled_tokens integer not null default 0,
      status text not null,
      created_at text not null,
      settled_at text
    );

    create table if not exists usage_adjustments (
      id integer primary key,
      proxy_key_id integer not null,
      period_type text not null,
      period_start text not null,
      offset_tokens integer not null,
      reason text not null,
      created_at text not null
    );

    create table if not exists admin_sessions (
      id text primary key,
      admin_user_id integer not null,
      csrf_token text not null,
      created_at text not null,
      expires_at text not null,
      foreign key(admin_user_id) references admin_users(id) on delete cascade
    );

    create index if not exists idx_usage_events_created_at on usage_events_recent(created_at);
    create index if not exists idx_usage_events_proxy_key on usage_events_recent(proxy_key_id);
    create index if not exists idx_usage_events_upstream_key on usage_events_recent(upstream_key_id);
    create index if not exists idx_usage_hourly_bucket on usage_hourly(bucket_start);
    create index if not exists idx_usage_daily_bucket on usage_daily(bucket_start);
    create index if not exists idx_usage_reservations_proxy_status on usage_reservations(proxy_key_id, status);
  `);

  db.prepare(`
    insert or ignore into schema_migrations(version, applied_at)
    values(1, ?)
  `).run(new Date().toISOString());
}
