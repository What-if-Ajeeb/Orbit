import { NativeModule, requireNativeModule } from 'expo';

declare class OrbitMobileSandboxModule extends NativeModule<{}> {
  describe(): Promise<string>;
  validateManifest(manifestJson: string): Promise<string>;
  checkPermission(requestJson: string): Promise<string>;
  validatePath(requestJson: string): Promise<string>;
  validateNetwork(requestJson: string): Promise<string>;
  validateRequest(requestJson: string): Promise<string>;
  authorizeOperation(requestJson: string): Promise<string>;
  readFile(requestJson: string): Promise<string>;
  shutdown(): Promise<string>;
}

export default requireNativeModule<OrbitMobileSandboxModule>('OrbitMobileSandbox');
