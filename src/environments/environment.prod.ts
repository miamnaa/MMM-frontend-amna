export const environment = {
  production: true,
  // Auth and Projects have a real backend behind them (API-REFERENCE.md).
  // Datasets and Experiments don't exist as routes yet - stay mocked so the
  // app shows sample data instead of a wall of 404s.
  mock: {
    auth: false,
    projects: false,
    datasets: true,
    experiments: true,
  },
  apiBaseUrl: 'https://mmm-back-end-anas.onrender.com/api/v1',
  entra: {
    clientId: 'fa733969-d53d-46ed-81fc-119c740a5cc9',
    tenantId: 'd5619769-1863-41fe-86e3-95000d84f2a6',
    apiScope: 'api://fa733969-d53d-46ed-81fc-119c740a5cc9/access_as_user',
  },
};
