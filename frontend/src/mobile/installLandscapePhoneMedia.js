// Imported FIRST by main.jsx: imports are evaluated before main.jsx's own
// body, so this has to be its own module for `matchMedia` to be wrapped before
// any other module can call it.
import { installLandscapePhoneMatchMedia } from './landscapePhoneMedia';

installLandscapePhoneMatchMedia();
