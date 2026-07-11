import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROTO_PATH = join(__dirname, '..', '..', '..', 'proto', 'github_notifier.proto');

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const proto = grpc.loadPackageDefinition(packageDef) as unknown as {
  github_notifier: {
    GitHubNotifier: grpc.ServiceClientConstructor;
  };
};

/** Builds the gRPC server around an injected service implementation. */
export function createGrpcServer(serviceImpl: grpc.UntypedServiceImplementation): grpc.Server {
  const server = new grpc.Server();
  server.addService(proto.github_notifier.GitHubNotifier.service, serviceImpl);
  return server;
}

export function startGrpcServer(
  port: number,
  serviceImpl: grpc.UntypedServiceImplementation,
): Promise<grpc.Server | null> {
  return new Promise((resolve) => {
    const server = createGrpcServer(serviceImpl);
    server.bindAsync(
      `0.0.0.0:${port}`,
      grpc.ServerCredentials.createInsecure(),
      (err, boundPort) => {
        if (err) {
          console.warn(`gRPC server failed to start on port ${port}: ${err.message}`);
          resolve(null);
          return;
        }
        console.log(`gRPC server listening on port ${boundPort}`);
        resolve(server);
      },
    );
  });
}
