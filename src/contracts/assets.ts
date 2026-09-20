/**
 * 资产规范与真实数据门禁接口
 * 依据 02-ASSETS.zh-CN.md 定义
 */

export type AssetProvenanceClass =
  | 'raw-observation'
  | 'processed-observation'
  | 'observation-derived-visualization'
  | 'enhanced-multispectral-observation'
  | 'near-infrared-observation'
  | 'observational-constraint-illustration'
  | 'reconstructed-appearance';

export type TextureRole =
  | 'color'
  | 'night'
  | 'cloud'
  | 'ring'
  | 'height'
  | 'normal'
  | 'enhanced-color'
  | 'infrared';

export interface ProductionTextureAsset {
  id: string;
  bodyId: string;
  role: TextureRole;
  sourcePage: string;
  sourceAssetUrl: string;
  localPath: string; // relative to public/
  sourceSha256: string;
  derivedSha256: string;
  originalWidth: number;
  originalHeight: number;
  derivedWidth: number;
  derivedHeight: number;
  projection: 'equirectangular' | 'radial-ring' | 'polar';
  longitudeConvention: '0-to-360-east' | 'standard';
  centralMeridianDeg: number | null;
  northUp: boolean;
  colorInterpretation: 'sRGB' | 'linear';
  observationBands: string[];
  provenanceClass: AssetProvenanceClass;
  coverageNotes: string;
  processingHistory: string[];
  credit: string;
  licenseUrl: string;
  licenseNotes: string;
  releaseApproved: boolean;
}

export interface AssetManifest {
  schemaVersion: number;
  generatedAt: string;
  assets: ProductionTextureAsset[];
}
