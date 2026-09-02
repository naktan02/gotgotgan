import { placeWebBrowserAuth } from './place-browser-auth-application'

export {
  createBrowserAuthHttp,
  type BrowserAuthHttpDependencies,
  type BrowserAuthRuntime,
} from '@place/browser-auth'

export const browserAuthHttp = placeWebBrowserAuth.http
