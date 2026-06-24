exports.up = (pgm) => {
  pgm.createTable('sagas', {
    id: { type: 'uuid', primaryKey: true },
    saga_type: { type: 'varchar(100)', notNull: true },
    version: { type: 'integer', notNull: true, default: 1 },
    status: {
      type: 'varchar(20)',
      notNull: true,
      default: 'PENDING',
      check: "status IN ('PENDING','STEP_IN_PROGRESS','COMPLETED','FAILED','COMPENSATING','COMPENSATED','CANCELLED')",
    },
    current_step: { type: 'integer', notNull: true, default: 0 },
    state: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    fail_reason: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });

  pgm.createTable('saga_steps', {
    id: { type: 'bigserial', primaryKey: true },
    saga_id: { type: 'uuid', notNull: true, references: 'sagas(id)', onDelete: 'CASCADE' },
    step_index: { type: 'integer', notNull: true },
    step_name: { type: 'varchar(100)', notNull: true },
    step_type: { type: 'varchar(20)', notNull: true, check: "step_type IN ('forward','compensate')" },
    status: {
      type: 'varchar(20)',
      notNull: true,
      default: 'PENDING',
      check: "status IN ('PENDING','IN_PROGRESS','COMPLETED','FAILED')",
    },
    started_at: { type: 'timestamptz' },
    finished_at: { type: 'timestamptz' },
    error: { type: 'text' },
  });

  pgm.createIndex('saga_steps', 'saga_id');

  pgm.createTable('outbox', {
    id: { type: 'bigserial', primaryKey: true },
    routing_key: { type: 'varchar(100)', notNull: true },
    payload: { type: 'jsonb', notNull: true },
    status: {
      type: 'varchar(20)',
      notNull: true,
      default: 'PENDING',
      check: "status IN ('PENDING','SENT','FAILED')",
    },
    saga_id: { type: 'uuid', references: 'sagas(id)', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });

  pgm.createIndex('outbox', 'status');
  pgm.createIndex('outbox', 'created_at');
};

exports.down = (pgm) => {
  pgm.dropTable('outbox');
  pgm.dropTable('saga_steps');
  pgm.dropTable('sagas');
};
