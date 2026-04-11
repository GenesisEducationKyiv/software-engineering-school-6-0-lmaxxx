// NOTE: .cjs because node-pg-migrate doesn't support ESM migrations
exports.up = (pgm) => {
  pgm.createTable('repositories', {
    id: 'id',
    repo: { type: 'varchar(255)', notNull: true, unique: true },
    last_seen_tag: { type: 'varchar(255)' },
    last_checked_at: { type: 'timestamp' },
  });

  pgm.createTable('subscriptions', {
    id: 'id',
    email: { type: 'varchar(255)', notNull: true },
    repo: { type: 'varchar(255)', notNull: true },
    confirmed: { type: 'boolean', default: false },
    confirm_token: { type: 'varchar(255)', unique: true },
    unsubscribe_token: { type: 'varchar(255)', unique: true },
    created_at: { type: 'timestamp', default: pgm.func('current_timestamp') },
  });

  pgm.addConstraint('subscriptions', 'unique_email_repo', {
    unique: ['email', 'repo'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('subscriptions');
  pgm.dropTable('repositories');
};
