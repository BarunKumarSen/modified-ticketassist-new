export interface IndianCenterSeed {
  id: string;
  name: string;
  stateRegion: string;
}

export const DEFAULT_INDIAN_CENTER = 'Mumbai';

export const LEGACY_CENTER_NAMES = ['Dhaka HQ', 'Sylhet', 'Chittagong'] as const;

export const LEGACY_TO_INDIAN_CENTER_MAP: Record<string, string> = {
  'Dhaka HQ': 'Mumbai',
  Sylhet: 'Bengaluru',
  Chittagong: 'Chennai',
  Dhaka: 'Mumbai',
};

export function normalizeCenterName(value?: string | null): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return DEFAULT_INDIAN_CENTER;
  return LEGACY_TO_INDIAN_CENTER_MAP[trimmed] || trimmed;
}

const RAW_INDIAN_CITIES: Array<[string, string]> = [
  ['Agartala', 'Tripura'],
  ['Agra', 'Uttar Pradesh'],
  ['Ahmedabad', 'Gujarat'],
  ['Aizawl', 'Mizoram'],
  ['Ajmer', 'Rajasthan'],
  ['Akola', 'Maharashtra'],
  ['Aligarh', 'Uttar Pradesh'],
  ['Ambala', 'Haryana'],
  ['Amravati', 'Maharashtra'],
  ['Amritsar', 'Punjab'],
  ['Anand', 'Gujarat'],
  ['Anantapur', 'Andhra Pradesh'],
  ['Asansol', 'West Bengal'],
  ['Aurangabad', 'Maharashtra'],
  ['Bareilly', 'Uttar Pradesh'],
  ['Belagavi', 'Karnataka'],
  ['Bengaluru', 'Karnataka'],
  ['Bhavnagar', 'Gujarat'],
  ['Bhilai', 'Chhattisgarh'],
  ['Bhopal', 'Madhya Pradesh'],
  ['Bhubaneswar', 'Odisha'],
  ['Bikaner', 'Rajasthan'],
  ['Bilaspur', 'Chhattisgarh'],
  ['Bokaro', 'Jharkhand'],
  ['Chandigarh', 'Chandigarh'],
  ['Chennai', 'Tamil Nadu'],
  ['Coimbatore', 'Tamil Nadu'],
  ['Cuttack', 'Odisha'],
  ['Dehradun', 'Uttarakhand'],
  ['Dhanbad', 'Jharkhand'],
  ['Dibrugarh', 'Assam'],
  ['Durgapur', 'West Bengal'],
  ['Erode', 'Tamil Nadu'],
  ['Faridabad', 'Haryana'],
  ['Gandhinagar', 'Gujarat'],
  ['Gangtok', 'Sikkim'],
  ['Gaya', 'Bihar'],
  ['Ghaziabad', 'Uttar Pradesh'],
  ['Gorakhpur', 'Uttar Pradesh'],
  ['Greater Noida', 'Uttar Pradesh'],
  ['Guntur', 'Andhra Pradesh'],
  ['Gurugram', 'Haryana'],
  ['Guwahati', 'Assam'],
  ['Gwalior', 'Madhya Pradesh'],
  ['Haridwar', 'Uttarakhand'],
  ['Hisar', 'Haryana'],
  ['Hosur', 'Tamil Nadu'],
  ['Hubballi', 'Karnataka'],
  ['Hyderabad', 'Telangana'],
  ['Imphal', 'Manipur'],
  ['Indore', 'Madhya Pradesh'],
  ['Itanagar', 'Arunachal Pradesh'],
  ['Jabalpur', 'Madhya Pradesh'],
  ['Jaipur', 'Rajasthan'],
  ['Jalandhar', 'Punjab'],
  ['Jalgaon', 'Maharashtra'],
  ['Jammu', 'Jammu & Kashmir'],
  ['Jamnagar', 'Gujarat'],
  ['Jamshedpur', 'Jharkhand'],
  ['Jhansi', 'Uttar Pradesh'],
  ['Jodhpur', 'Rajasthan'],
  ['Kalaburagi', 'Karnataka'],
  ['Kalyan', 'Maharashtra'],
  ['Kanpur', 'Uttar Pradesh'],
  ['Karimnagar', 'Telangana'],
  ['Karnal', 'Haryana'],
  ['Kochi', 'Kerala'],
  ['Kolhapur', 'Maharashtra'],
  ['Kolkata', 'West Bengal'],
  ['Kollam', 'Kerala'],
  ['Kota', 'Rajasthan'],
  ['Kozhikode', 'Kerala'],
  ['Kurnool', 'Andhra Pradesh'],
  ['Lucknow', 'Uttar Pradesh'],
  ['Ludhiana', 'Punjab'],
  ['Madurai', 'Tamil Nadu'],
  ['Mangaluru', 'Karnataka'],
  ['Meerut', 'Uttar Pradesh'],
  ['Mohali', 'Punjab'],
  ['Moradabad', 'Uttar Pradesh'],
  ['Mumbai', 'Maharashtra'],
  ['Muzaffarpur', 'Bihar'],
  ['Mysuru', 'Karnataka'],
  ['Nagpur', 'Maharashtra'],
  ['Nanded', 'Maharashtra'],
  ['Nashik', 'Maharashtra'],
  ['Navi Mumbai', 'Maharashtra'],
  ['Nellore', 'Andhra Pradesh'],
  ['New Delhi', 'Delhi NCR'],
  ['Noida', 'Uttar Pradesh'],
  ['Panaji', 'Goa'],
  ['Panipat', 'Haryana'],
  ['Patiala', 'Punjab'],
  ['Patna', 'Bihar'],
  ['Pimpri-Chinchwad', 'Maharashtra'],
  ['Prayagraj', 'Uttar Pradesh'],
  ['Puducherry', 'Puducherry'],
  ['Pune', 'Maharashtra'],
  ['Raipur', 'Chhattisgarh'],
  ['Rajahmundry', 'Andhra Pradesh'],
  ['Rajkot', 'Gujarat'],
  ['Ranchi', 'Jharkhand'],
  ['Rohtak', 'Haryana'],
  ['Rourkela', 'Odisha'],
  ['Salem', 'Tamil Nadu'],
  ['Secunderabad', 'Telangana'],
  ['Shillong', 'Meghalaya'],
  ['Shimla', 'Himachal Pradesh'],
  ['Siliguri', 'West Bengal'],
  ['Solapur', 'Maharashtra'],
  ['Sonipat', 'Haryana'],
  ['Srinagar', 'Jammu & Kashmir'],
  ['Surat', 'Gujarat'],
  ['Thane', 'Maharashtra'],
  ['Thiruvananthapuram', 'Kerala'],
  ['Thrissur', 'Kerala'],
  ['Tiruchirappalli', 'Tamil Nadu'],
  ['Tirunelveli', 'Tamil Nadu'],
  ['Tirupati', 'Andhra Pradesh'],
  ['Tiruppur', 'Tamil Nadu'],
  ['Udaipur', 'Rajasthan'],
  ['Ujjain', 'Madhya Pradesh'],
  ['Vadodara', 'Gujarat'],
  ['Varanasi', 'Uttar Pradesh'],
  ['Vasai-Virar', 'Maharashtra'],
  ['Vellore', 'Tamil Nadu'],
  ['Vijayawada', 'Andhra Pradesh'],
  ['Visakhapatnam', 'Andhra Pradesh'],
  ['Warangal', 'Telangana'],
];

export const INDIAN_CENTERS: IndianCenterSeed[] = RAW_INDIAN_CITIES.map(([name, stateRegion], idx) => ({
  id: `ctr_${String(idx + 1).padStart(3, '0')}`,
  name,
  stateRegion,
}));

export function filterCenters<T extends { name: string; stateRegion?: string }>(
  centers: T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return centers;
  return centers.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.stateRegion || '').toLowerCase().includes(q)
  );
}
