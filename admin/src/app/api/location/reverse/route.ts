import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { latitude, longitude } = await request.json();

    if (!latitude || !longitude) {
      return NextResponse.json({ success: false, error: 'Missing coordinates' }, { status: 400 });
    }

    // 1. Get Amap Key from environment variables
    const AMAP_KEY = process.env.AMAP_KEY || 'YOUR_AMAP_WEB_SERVICE_KEY'; 

    if (AMAP_KEY === 'YOUR_AMAP_WEB_SERVICE_KEY') {
      // Fallback to mock logic if key is not configured yet
      let city = '';
      if (latitude > 39 && latitude < 41 && longitude > 115 && longitude < 117) {
        city = '北京市';
      } else if (latitude > 22 && latitude < 24 && longitude > 113 && longitude < 115) {
        city = '深圳市';
      } else if (latitude > 23 && latitude < 25 && longitude > 112 && longitude < 114) {
        city = '广州市';
      }
      return NextResponse.json({ success: true, data: { city, latitude, longitude, isMock: true } });
    }

    // 2. Call Amap Reverse Geocoding API
    // Documentation: https://lbs.amap.com/api/webservice/guide/api/georegeo
    const amapUrl = `https://restapi.amap.com/v3/geocode/regeo?key=${AMAP_KEY}&location=${longitude},${latitude}&output=json&radius=1000&extensions=all`;
    console.log('Calling Amap API:', amapUrl);
    
    const response = await fetch(amapUrl);
    const result = await response.json();
    console.log('Amap API Result:', result);

    if (result.status === '1' && result.regeocode) {
      const addressComponent = result.regeocode.addressComponent;
      // Get city name, handle cases where city is empty (like in municipalities Beijing/Shanghai)
      let city = addressComponent.city;
      if (!city || city.length === 0 || Array.isArray(city)) {
        city = addressComponent.province;
      }

      return NextResponse.json({
        success: true,
        data: {
          city: typeof city === 'string' ? city : '',
          address: result.regeocode.formatted_address,
          latitude,
          longitude
        }
      });
    }

    return NextResponse.json({ success: false, error: 'Amap API failed: ' + (result.info || 'Unknown error') }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
