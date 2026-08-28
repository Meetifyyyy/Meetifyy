import { UploadsController } from './uploads.controller';
import { StorageService } from './uploads.service';

describe('Preset Media Endpoint & Caching', () => {
  let controller: UploadsController;
  let mockStorageService: Partial<StorageService>;

  beforeEach(() => {
    mockStorageService = {};
    controller = new UploadsController(mockStorageService as StorageService);
  });

  it('should return preset media manifest with 36 images and 46 gifs', () => {
    const mockReq: any = { headers: {} };
    let statusCode: number = 0;
    let jsonBody: any = null;
    const headers: Record<string, string> = {};

    const mockRes: any = {
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      status: (code: number) => {
        statusCode = code;
        return {
          json: (body: any) => {
            jsonBody = body;
            return body;
          },
          end: () => null,
        };
      },
    };

    controller.getPresetMedia(mockReq, mockRes);

    expect(statusCode).toBe(200);
    expect(jsonBody).toBeDefined();
    expect(jsonBody.images).toBeDefined();
    expect(jsonBody.images.length).toBe(36);
    expect(jsonBody.gifs).toBeDefined();
    expect(jsonBody.gifs.length).toBe(46);

    // Verify presence of thumbnails and dimensions
    expect(jsonBody.images[0].thumbUrl).toBeDefined();
    expect(jsonBody.images[0].width).toBeGreaterThan(0);
    expect(jsonBody.gifs[0].posterUrl).toBeDefined();
    expect(jsonBody.gifs[0].frames).toBeGreaterThan(0);

    // Verify cache headers
    expect(headers['ETag']).toBeDefined();
    expect(headers['Last-Modified']).toBeDefined();
    expect(headers['Cache-Control']).toContain('stale-while-revalidate');
  });

  it('should respond with 304 Not Modified when If-None-Match matches ETag', () => {
    // First call to obtain ETag
    const headers1: Record<string, string> = {};
    const mockRes1: any = {
      setHeader: (k: string, v: string) => {
        headers1[k] = v;
      },
      status: () => ({
        json: (b: any) => b,
        end: () => null,
      }),
    };
    controller.getPresetMedia({ headers: {} } as any, mockRes1);
    const etag = headers1['ETag'];
    expect(etag).toBeDefined();

    // Second call with If-None-Match header
    let statusCode2 = 0;
    const mockReq2: any = { headers: { 'if-none-match': etag } };
    const mockRes2: any = {
      setHeader: () => null,
      status: (code: number) => {
        statusCode2 = code;
        return {
          end: () => null,
          json: () => null,
        };
      },
    };

    controller.getPresetMedia(mockReq2, mockRes2);
    expect(statusCode2).toBe(304);
  });
});
