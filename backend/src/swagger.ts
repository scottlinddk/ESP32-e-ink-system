import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ESP32 e-ink Display API',
      version: '1.0.0',
      description:
        'Backend API for the ESP32 e-ink display SaaS platform. Most endpoints require a Clerk JWT as a Bearer token. The device display-data endpoint uses a `licenseKey` query parameter instead.',
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Local development',
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Clerk JWT token obtained after authentication',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            display_name: { type: 'string', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        Device: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            user_id: { type: 'string', format: 'uuid' },
            device_id: { type: 'string', example: 'ESP-A1B2C3' },
            device_name: { type: 'string', example: 'Living Room Display' },
            license_key: { type: 'string', example: 'DSPL-A1B2-C3D4-E5F6' },
            firmware_version: { type: 'string', example: '1.0.0' },
            last_seen_at: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        UserPreferences: {
          type: 'object',
          properties: {
            show_energy_price: { type: 'boolean' },
            show_weather: { type: 'boolean' },
            show_news: { type: 'boolean' },
            show_air_quality: { type: 'boolean' },
            energy_price_location: {
              type: 'string',
              enum: ['DK1', 'DK2'],
              example: 'DK1',
            },
            weather_location: {
              type: 'string',
              example: '55.3,10.4',
              description: 'Latitude,Longitude',
            },
            news_language: {
              type: 'string',
              enum: ['da', 'en'],
              example: 'da',
            },
            refresh_interval_minutes: { type: 'integer', example: 30 },
          },
        },
        EnergyPrice: {
          type: 'object',
          properties: {
            now: { type: 'number', description: 'Current price in øre/kWh' },
            average: { type: 'number', description: 'Daily average in øre/kWh' },
            trend: { type: 'string', enum: ['up', 'down', 'stable'] },
          },
        },
        WeatherData: {
          type: 'object',
          properties: {
            temp: { type: 'number', description: 'Temperature in Celsius' },
            condition: { type: 'string', example: 'Clear' },
            windSpeed: { type: 'number', description: 'Wind speed in m/s' },
            icon: { type: 'string', example: '01d' },
          },
        },
        NewsItem: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            url: { type: 'string', format: 'uri' },
          },
        },
        DisplayData: {
          type: 'object',
          properties: {
            nextRefresh: {
              type: 'integer',
              description: 'Milliseconds until the device should next poll',
              example: 1800000,
            },
            price: { $ref: '#/components/schemas/EnergyPrice' },
            weather: { $ref: '#/components/schemas/WeatherData' },
            news: {
              type: 'array',
              items: { $ref: '#/components/schemas/NewsItem' },
            },
          },
        },
        ApiKey: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            provider: {
              type: 'string',
              enum: ['openweathermap', 'newsapi', 'openai'],
            },
            api_key: {
              type: 'string',
              description: 'Masked key value (first 6 chars + ••••••••)',
              example: 'abc123••••••••',
            },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
