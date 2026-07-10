// NOTE: .cjs because node-pg-migrate doesn't support ESM migrations
exports.up = (pgm) => {
  pgm.dropConstraint('subscriptions', 'subscriptions_pkey');
  pgm.dropColumn('subscriptions', 'id');
  pgm.addColumn('subscriptions', {
    id: { type: 'uuid', notNull: true, primaryKey: true },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('subscriptions', 'id');
  pgm.addColumn('subscriptions', { id: 'id' });
};
