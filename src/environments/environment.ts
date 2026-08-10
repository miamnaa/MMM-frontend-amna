export const environment = {
  production: false,
  /**
   * Auth and Projects are the only domains with a real backend today (see
   * API-REFERENCE.md) and DatasetService/ExperimentService reflect that in
   * their own implementation - they return empty rather than fabricated
   * rows, no flag needed here to switch them off. If you're running the
   * NestJS API locally instead of the shared Render instance, point this at
   * http://localhost:3000/api/v1.
   */
  apiBaseUrl: 'https://mmm-back-end-anas.onrender.com/api/v1',
  /**
   * Real Entra app registration - the backend already validates tokens
   * issued for this exact client/tenant, so local dev talks to the same
   * identity as production.
   */
  entra: {
    clientId: 'fa733969-d53d-46ed-81fc-119c740a5cc9',
    tenantId: 'd5619769-1863-41fe-86e3-95000d84f2a6',
    apiScope: 'api://fa733969-d53d-46ed-81fc-119c740a5cc9/access_as_user',
  },
};
