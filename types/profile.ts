export const GARMENT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;

export type GarmentSize = (typeof GARMENT_SIZES)[number];

export const STYLE_TAGS = [
  { value: 'minimal', label: 'Minimal' },
  { value: 'street', label: 'Sokak' },
  { value: 'classic', label: 'Klasik' },
  { value: 'sport', label: 'Spor' },
] as const;

export type StyleTag = (typeof STYLE_TAGS)[number]['value'];

export interface UserStudioProfile {
  userId: string;
  heightCm: number | null;
  weightKg: number | null;
  topSize: GarmentSize | null;
  bottomSize: GarmentSize | null;
  styleTags: StyleTag[];
  modelPhotoPath: string | null;
  favoriteBrands?: string[];
  preferredColors?: string[];
  priceRange?: { min: number; max: number } | null;
}

export interface StudioProfilePatch {
  heightCm?: number | null;
  weightKg?: number | null;
  topSize?: GarmentSize | null;
  bottomSize?: GarmentSize | null;
  styleTags?: StyleTag[];
  modelPhotoPath?: string | null;
  favoriteBrands?: string[];
  preferredColors?: string[];
  priceRange?: { min: number; max: number } | null;
}

export const STUDIO_BRANDS = [
  'ZARA',
  'Mavi',
  'Koton',
  'DeFacto',
  'Boyner',
  'Derimod',
  'Nike',
  'adidas',
  'Puma',
  'Jack & Jones',
] as const;
export const STUDIO_COLORS = [
  { label: 'Siyah', hex: '#111111' },
  { label: 'Gri', hex: '#606060' },
  { label: 'Açık gri', hex: '#D1D1D1' },
  { label: 'Beyaz', hex: '#FFFFFF' },
  { label: 'Bej', hex: '#EDE0D0' },
  { label: 'Kahverengi', hex: '#906044' },
  { label: 'Lacivert', hex: '#172F50' },
  { label: 'Mavi', hex: '#2D62A5' },
  { label: 'Yeşil', hex: '#2E5B43' },
  { label: 'Haki', hex: '#AAA780' },
  { label: 'Kırmızı', hex: '#E52527' },
  { label: 'Pembe', hex: '#F5ACC0' },
  { label: 'Sarı', hex: '#FBD76C' },
  { label: 'Turuncu', hex: '#FF7B24' },
  { label: 'Mor', hex: '#683093' },
  { label: 'Açık mavi', hex: '#B4D5EB' },
] as const;

export const HEIGHT_CM_MIN = 150;
export const HEIGHT_CM_MAX = 210;
export const WEIGHT_KG_MIN = 40;
export const WEIGHT_KG_MAX = 150;
export const HEIGHT_CM_DEFAULT = 170;
export const WEIGHT_KG_DEFAULT = 65;
