import { NativeModule, requireNativeModule } from 'expo';

declare class OrbitMobileSandboxModule extends NativeModule<{}> {
  describe(): Promise<string>;
  validateManifest(manifestJson: string): Promise<string>;
  execute(requestJson: string): Promise<string>;
  shutdown(): Promise<string>;
}

export default requireNativeModule<OrbitMobileSandboxModule>('OrbitMobileSandbox');
