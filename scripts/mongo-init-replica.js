// Run by the Docker Compose healthcheck via mongosh.
// Initiates a single-member replica set "rs0" if needed, then exits non-zero
// until the node has become PRIMARY.
//
// The member host is "localhost:27017" so that applications on the host machine
// (connecting to localhost:27017 through the published port) can reach the primary.
try {
  rs.status();
} catch {
  rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] });
}

if (!db.hello().isWritablePrimary) {
  print('Replica set not ready yet');
  quit(1);
}
