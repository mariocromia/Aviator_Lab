export interface LicenseStatus { status: 'LOCAL_MASTER'; expiresAt: null; }
export interface FeatureLimits { maxTerminals: null; screenController: boolean; allFeatures: boolean; }

export interface LicenseService { initialize(): Promise<void>; getStatus(): LicenseStatus; }
export class LocalLicenseService implements LicenseService {
  async initialize() { return; }
  getStatus(): LicenseStatus { return { status: 'LOCAL_MASTER', expiresAt: null }; }
}

export interface FeatureAccessService { getLimits(): FeatureLimits; validateFeature(feature: string): boolean; }
export class MasterFeatureAccessService implements FeatureAccessService {
  getLimits(): FeatureLimits { return { maxTerminals: null, screenController: true, allFeatures: true }; }
  validateFeature() { return true; }
}
