// Re-export the native module. On web, it will be resolved to OrbitMobileSandboxModule.web.ts
// and on native platforms to OrbitMobileSandboxModule.ts
export { default } from './src/OrbitMobileSandboxModule';
export * from './src/OrbitMobileSandbox.types';
