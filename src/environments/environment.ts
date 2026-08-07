export const environment = {
  production: false,
  /**
   * While the NestJS API is still in progress, every service reads from the
   * in-memory mock backend. Flip this to false once `apiBaseUrl` is live —
   * each service already has the HttpClient path written alongside the mock.
   */
  useMockApi: true,
  apiBaseUrl: 'http://localhost:3000/api/v1',
  /**
   * Real Entra app registration - the backend already validates tokens
   * issued for this exact client/tenant, so local dev talks to the same
   * identity as production. Only the API base URL above is mocked out.
   */
  entra: {
    clientId: 'fa733969-d53d-46ed-81fc-119c740a5cc9',
    tenantId: 'd5619769-1863-41fe-86e3-95000d84f2a6',
    apiScope: 'api://fa733969-d53d-46ed-81fc-119c740a5cc9/access_as_user',
  },
};
