INSERT INTO "settings" ("id", "max_running", "cpu_per_session", "memory_gb_per_session", "disk_gb_per_session", "min_free_disk_gb", "usage_reset_display", "usage_warn_pct", "usage_danger_pct", "time_zone")
VALUES (1, 3, 4, 8, 40, 10, 'countdown', 80, 95, 'UTC')
ON CONFLICT ("id") DO NOTHING;
