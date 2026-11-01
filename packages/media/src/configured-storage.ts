import {
  CloudinaryAudioStorage,
  cloudinaryOptionsFromUrl,
} from './cloudinary.js'
import { LocalAudioStorage, type AudioStorage } from './storage.js'

export interface AudioStorageConfiguration {
  provider: 'local' | 'cloudinary'
  localRoot: string
  cloudinaryUrl?: string
  cloudinaryFolder: string
}

export function createConfiguredAudioStorage(
  configuration: AudioStorageConfiguration,
): AudioStorage {
  if (configuration.provider === 'local') {
    return new LocalAudioStorage(configuration.localRoot)
  }
  if (!configuration.cloudinaryUrl) {
    throw new Error('CLOUDINARY_URL is required for Cloudinary audio storage.')
  }
  return new CloudinaryAudioStorage(
    cloudinaryOptionsFromUrl(
      configuration.cloudinaryUrl,
      configuration.cloudinaryFolder,
    ),
  )
}
