import config from '../constants/config';

const handleResponse = async (response) => {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Request failed');
  }
  return data;
};

const apiService = {
  getTest: async () => {
    const response = await fetch(`${config.API_BASE_URL}/test/test`);
    return handleResponse(response);
  },
};

export default apiService;
