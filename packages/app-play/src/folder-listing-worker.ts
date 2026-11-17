// Walks a remembered folder off the page's thread (`services/folder-listing.ts`).
import { serveFolderListing } from './services/folder-listing.ts';

serveFolderListing(globalThis as unknown as Parameters<typeof serveFolderListing>[0]);
