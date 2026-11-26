import { NativeModule, registerWebModule } from 'expo';

class OrbitMobileSandboxModule extends NativeModule<{}> {
  private unavailable(): never {
    throw new Error('The ORBIT mobile sandbox is Android-only.');
  }

  describe(): Promise<string> {
    return Promise.reject(this.unavailable());
  }

  validateManifest(): Promise<string> {
    return Promise.reject(this.unavailable());
  }

  checkPermission(): Promise<string> {
    return Promise.reject(this.unavailable());
  }

  validatePath(): Promise<string> {
    return Promise.reject(this.unavailable());
  }

  validateNetwork(): Promise<string> {
    return Promise.reject(this.unavailable());
  }

  validateRequest(): Promise<string> {
    return Promise.reject(this.unavailable());
  }

  authorizeOperation(): Promise<string> {
    return Promise.reject(this.unavailable());
  }

  readFile(): Promise<string> {
    return Promise.reject(this.unavailable());
  }

  shutdown(): Promise<string> {
    return Promise.reject(this.unavailable());
  }
}

export default registerWebModule(OrbitMobileSandboxModule, 'OrbitMobileSandbox');
