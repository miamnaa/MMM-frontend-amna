export const environment = {
  production: false,
  /**
   * While the NestJS API is still in progress, every service reads from the
   * in-memory mock backend. Flip this to false once `apiBaseUrl` is live —
   * each service already has the HttpClient path written alongside the mock.
   */
  useMockApi: true,
  apiBaseUrl: 'http://localhost:3000/api/v1',
};
