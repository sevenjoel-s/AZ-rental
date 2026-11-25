import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Film, ImagePlus, MapPin, ShieldCheck, Trash2, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { Category, Listing, LocationItem } from '../types';

interface Props {
  isOpen: boolean;
  categories: Category[];
  locations: LocationItem[];
  onClose: () => void;
  onCreated: (listing: Listing) => void;
  onRequireServicePass?: () => void;
}

interface PendingImage {
  file: File;
  previewUrl: string;
}

export const PostRentalModal: React.FC<Props> = ({
  isOpen,
  categories,
  locations,
  onClose,
  onCreated,
  onRequireServicePass,
}) => {
  const [categoryId, setCategoryId] = useState<number>(categories[0]?.id || 1);
  const [subcategoryId, setSubcategoryId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [titleAm, setTitleAm] = useState('');
  const [description, setDescription] = useState('');
  const [priceHourly, setPriceHourly] = useState('');
  const [priceDaily, setPriceDaily] = useState('');
  const [priceWeekly, setPriceWeekly] = useState('');
  const [priceMonthly, setPriceMonthly] = useState('');
  const [primaryDuration, setPrimaryDuration] = useState('monthly');

  const [region, setRegion] = useState('Addis Ababa');
  const [city, setCity] = useState('Addis Ababa');
  const [subCity, setSubCity] = useState('Bole');
  const [neighborhood, setNeighborhood] = useState('');
  const [addressDetail, setAddressDetail] = useState('');
  const [latitude, setLatitude] = useState('8.9974');
  const [longitude, setLongitude] = useState('38.7892');
  const [exactLocationVisible, setExactLocationVisible] = useState(true);
  const [rentalConditions, setRentalConditions] = useState('Written rental agreement required prior to handover.');
  const [contactPreference, setContactPreference] = useState('chat_call');

  // Category-specific specs
  const [vehicleBrand, setVehicleBrand] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleYear, setVehicleYear] = useState('2024');
  const [transmission, setTransmission] = useState('Automatic');
  const [fuelType, setFuelType] = useState('Petrol');
  const [passengerCapacity, setPassengerCapacity] = useState('5');
  const [driverAvailable, setDriverAvailable] = useState(false);

  const [operatorAvailable, setOperatorAvailable] = useState(true);
  const [fuelArrangement, setFuelArrangement] = useState('Renter supplies diesel');
  const [transportFee, setTransportFee] = useState('');

  const [bedrooms, setBedrooms] = useState('2');
  const [bathrooms, setBathrooms] = useState('1');
  const [furnished, setFurnished] = useState(true);

  const [images, setImages] = useState<PendingImage[]>([]);
  const [video, setVideo] = useState<{ file: File; previewUrl: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === categoryId) || categories[0],
    [categories, categoryId]
  );

  const regions = useMemo(() => Array.from(new Set(locations.map((l) => l.region))), [locations]);
  const citiesInRegion = useMemo(
    () => Array.from(new Set(locations.filter((l) => l.region === region).map((l) => l.city))),
    [locations, region]
  );

  if (!isOpen) return null;

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError('');
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if (images.length + files.length > 10) {
      setError('Maximum 10 images allowed per listing.');
      return;
    }
    const added: PendingImage[] = [];
    for (const f of files) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
        setError(`Unsupported image format: ${f.name}`);
        continue;
      }
      added.push({ file: f, previewUrl: URL.createObjectURL(f) });
    }
    setImages((prev) => [...prev, ...added]);
    e.target.value = '';
  };

  const moveImage = (idx: number, dir: -1 | 1) => {
    setImages((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      return copy;
    });
  };

  const removeImage = (idx: number) => {
    setImages((prev) => {
      URL.revokeObjectURL(prev[idx].previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError('');
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)) {
      setError('Video must be MP4, WebM, or MOV.');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError('Video file must be under 50 MB.');
      return;
    }
    if (video) URL.revokeObjectURL(video.previewUrl);
    setVideo({ file, previewUrl: URL.createObjectURL(file) });
    e.target.value = '';
  };

  const handleDetectGps = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude.toFixed(5));
        setLongitude(pos.coords.longitude.toFixed(5));
      },
      () => setError('Unable to retrieve GPS coordinates. Check location permission.')
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (images.length < 1) {
      setError('Please upload at least 1 listing photo (up to 10 allowed).');
      return;
    }
    if (!priceDaily && !priceWeekly && !priceMonthly && !priceHourly) {
      setError('Please enter at least one rental price in ETB.');
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('categoryId', String(categoryId));
      if (subcategoryId) fd.append('subcategoryId', subcategoryId);
      fd.append('title', title);
      fd.append('titleAm', titleAm);
      fd.append('description', description);
      if (priceHourly) fd.append('priceHourly', priceHourly);
      if (priceDaily) fd.append('priceDaily', priceDaily);
      if (priceWeekly) fd.append('priceWeekly', priceWeekly);
      if (priceMonthly) fd.append('priceMonthly', priceMonthly);
      fd.append('primaryDuration', primaryDuration);
      fd.append('region', region);
      fd.append('city', city);
      fd.append('subCity', subCity);
      fd.append('neighborhood', neighborhood);
      fd.append('addressDetail', addressDetail);
      fd.append('latitude', latitude);
      fd.append('longitude', longitude);
      fd.append('exactLocationVisible', String(exactLocationVisible));
      fd.append('rentalConditions', rentalConditions);
      fd.append('contactPreference', contactPreference);

      const specs: Record<string, any> = {};
      if (selectedCategory?.slug === 'car') {
        Object.assign(specs, {
          brand: vehicleBrand,
          model: vehicleModel,
          year: Number(vehicleYear),
          transmission,
          fuelType,
          passengerCapacity: Number(passengerCapacity),
          driverAvailable,
        });
      } else if (selectedCategory?.slug === 'machinery') {
        Object.assign(specs, {
          operatorAvailable,
          fuelArrangement,
          transportFee,
        });
      } else if (selectedCategory?.slug === 'house') {
        Object.assign(specs, {
          bedrooms: Number(bedrooms),
          bathrooms: Number(bathrooms),
          furnished,
        });
      }
      fd.append('specs', JSON.stringify(specs));

      images.forEach((im) => fd.append('images', im.file));
      if (video) fd.append('video', video.file);

      const res = await apiFetch<{ listing: Listing }>('/api/listings', {
        method: 'POST',
        body: fd,
      });
      onCreated(res.listing);
      onClose();
    } catch (err: any) {
      setError(err.message);
      if (err?.status === 402 || err?.data?.code === 'SUBSCRIPTION_REQUIRED') onRequireServicePass?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900 my-8">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <h2 className="text-xl font-bold text-[#123B65] dark:text-white">Post a Rental on AZ RENTAL</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              All uploaded images & videos are automatically protected with the official AZ RENTAL watermark.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-5 max-h-[72vh] overflow-y-auto pr-2">
          {/* Category & Subcategory */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Rental Category *
              </label>
              <select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(Number(e.target.value));
                  setSubcategoryId('');
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name_en} — {c.name_am}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Subcategory
              </label>
              <select
                value={subcategoryId}
                onChange={(e) => setSubcategoryId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="">Select subcategory</option>
                {(selectedCategory?.subcategories || []).map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.name_en} ({sc.name_am})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Titles & Description */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Listing Title (English) *
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Furnished 3BR Apartment in Bole"
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Amharic Title (Optional)
              </label>
              <input
                type="text"
                value={titleAm}
                onChange={(e) => setTitleAm(e.target.value)}
                placeholder="በቦሌ ዘመናዊ ባለ 3 መኝታ ቤት"
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Detailed Description *
            </label>
            <textarea
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe features, condition, utilities, included accessories..."
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          {/* Dynamic Category Specs */}
          {selectedCategory?.slug === 'car' && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <h3 className="text-xs font-bold text-[#123B65] dark:text-[#F5A623] mb-3">Vehicle Specifications</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <input type="text" placeholder="Brand (e.g. Toyota)" value={vehicleBrand} onChange={(e) => setVehicleBrand(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900" />
                <input type="text" placeholder="Model (e.g. Corolla)" value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900" />
                <input type="number" placeholder="Year" value={vehicleYear} onChange={(e) => setVehicleYear(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900" />
                <select value={transmission} onChange={(e) => setTransmission(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                  <option value="Automatic">Automatic</option>
                  <option value="Manual">Manual</option>
                </select>
                <select value={fuelType} onChange={(e) => setFuelType(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                  <option value="Petrol">Petrol</option>
                  <option value="Diesel">Diesel</option>
                  <option value="Hybrid">Hybrid</option>
                  <option value="Electric">Electric</option>
                </select>
                <input type="number" placeholder="Seats" value={passengerCapacity} onChange={(e) => setPassengerCapacity(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900" />
              </div>
              <label className="mt-3 flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={driverAvailable} onChange={(e) => setDriverAvailable(e.target.checked)} />
                Driver available on request
              </label>
            </div>
          )}

          {selectedCategory?.slug === 'machinery' && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <h3 className="text-xs font-bold text-[#123B65] dark:text-[#F5A623] mb-3">Heavy Machinery Terms</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input type="text" placeholder="Fuel arrangement" value={fuelArrangement} onChange={(e) => setFuelArrangement(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900" />
                <input type="text" placeholder="Mobilization / Transport Fee (ETB)" value={transportFee} onChange={(e) => setTransportFee(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900" />
              </div>
              <label className="mt-3 flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={operatorAvailable} onChange={(e) => setOperatorAvailable(e.target.checked)} />
                Certified operator included / available
              </label>
            </div>
          )}

          {selectedCategory?.slug === 'house' && (
            <div className="grid grid-cols-3 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <div>
                <label className="block text-[11px] font-semibold mb-1">Bedrooms / Rooms</label>
                <input type="number" min="0" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Bathrooms</label>
                <input type="number" min="0" value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900" />
              </div>
              <label className="flex items-center gap-2 text-xs pt-5">
                <input type="checkbox" checked={furnished} onChange={(e) => setFurnished(e.target.checked)} />
                Furnished
              </label>
            </div>
          )}

          {/* Pricing in ETB */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Rental Rates in Ethiopian Birr (ETB) *
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <input type="number" min="0" placeholder="Hourly (ETB)" value={priceHourly} onChange={(e) => setPriceHourly(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
              <input type="number" min="0" placeholder="Daily (ETB)" value={priceDaily} onChange={(e) => setPriceDaily(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
              <input type="number" min="0" placeholder="Weekly (ETB)" value={priceWeekly} onChange={(e) => setPriceWeekly(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
              <input type="number" min="0" placeholder="Monthly (ETB)" value={priceMonthly} onChange={(e) => setPriceMonthly(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
              <select value={primaryDuration} onChange={(e) => setPrimaryDuration(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800">
                <option value="hourly">Hourly Primary</option>
                <option value="daily">Daily Primary</option>
                <option value="weekly">Weekly Primary</option>
                <option value="monthly">Monthly Primary</option>
              </select>
            </div>
          </div>

          {/* Ethiopian Location */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Ethiopian Location & Map Pin *
              </label>
              <button
                type="button"
                onClick={handleDetectGps}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#123B65] hover:underline dark:text-[#F5A623]"
              >
                <MapPin className="h-3.5 w-3.5" />
                Use Current GPS
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <select
                value={region}
                onChange={(e) => {
                  const r = e.target.value;
                  setRegion(r);
                  const first = locations.find((l) => l.region === r);
                  if (first) {
                    setCity(first.city);
                    setSubCity(first.sub_city);
                    setLatitude(String(first.latitude));
                    setLongitude(String(first.longitude));
                  }
                }}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
              >
                {regions.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <input
                type="text"
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                list="az-cities-list"
                placeholder="City"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
              />
              <datalist id="az-cities-list">
                {citiesInRegion.map((c) => <option key={c} value={c} />)}
              </datalist>
              <input
                type="text"
                value={subCity}
                onChange={(e) => setSubCity(e.target.value)}
                placeholder="Sub-city / Woreda"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
              />
              <input
                type="text"
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
                placeholder="Neighborhood"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input type="text" value={addressDetail} onChange={(e) => setAddressDetail(e.target.value)} placeholder="Street / Landmark" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
              <input type="text" value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="Latitude" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono dark:border-slate-700 dark:bg-slate-800" />
              <input type="text" value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="Longitude" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono dark:border-slate-700 dark:bg-slate-800" />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <input type="checkbox" checked={exactLocationVisible} onChange={(e) => setExactLocationVisible(e.target.checked)} />
              Show exact pin on discovery map (uncheck for approximate neighborhood radius)
            </label>
          </div>

          {/* Image Upload (1-10) */}
          <div className="rounded-xl border border-dashed border-slate-300 p-4 dark:border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold text-[#123B65] dark:text-white">
                  Photos (Min 1, Max 10) — Auto-Watermarked with AZ RENTAL
                </h3>
                <p className="text-[11px] text-slate-500">
                  {images.length} / 10 selected. Reorder with arrows; originals are stored securely.
                </p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#123B65] px-3 py-2 text-xs font-semibold text-white hover:bg-[#0f3154]">
                <ImagePlus className="h-4 w-4" />
                Add Photos
                <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleImageSelect} />
              </label>
            </div>

            {images.length > 0 && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                {images.map((im, idx) => (
                  <div key={im.previewUrl} className="relative rounded-lg border border-slate-200 overflow-hidden bg-slate-100 dark:border-slate-700">
                    <img src={im.previewUrl} alt={`Preview ${idx + 1}`} className="h-24 w-full object-cover" />
                    <div className="flex items-center justify-between bg-slate-900/80 px-1.5 py-1 text-white">
                      <button type="button" onClick={() => moveImage(idx, -1)} disabled={idx === 0} className="p-0.5 disabled:opacity-30">
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <span className="text-[10px] font-mono">#{idx + 1}</span>
                      <button type="button" onClick={() => moveImage(idx, 1)} disabled={idx === images.length - 1} className="p-0.5 disabled:opacity-30">
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => removeImage(idx)} className="p-0.5 text-red-400">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Video Upload (Max 1) */}
          <div className="rounded-xl border border-dashed border-slate-300 p-4 dark:border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold text-[#123B65] dark:text-white">
                  Walkthrough Video (Optional, Max 1 video up to 50MB)
                </h3>
                <p className="text-[11px] text-slate-500">MP4, WebM, or MOV. Transcoded & watermarked via FFmpeg.</p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <Film className="h-4 w-4 text-[#F5A623]" />
                {video ? 'Replace Video' : 'Add Video'}
                <input type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={handleVideoSelect} />
              </label>
            </div>
            {video && (
              <div className="mt-3 flex items-center gap-3">
                <video src={video.previewUrl} controls className="h-28 rounded-lg border border-slate-200 dark:border-slate-700" />
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(video.previewUrl);
                    setVideo(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 dark:bg-red-950/50 dark:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove Video
                </button>
              </div>
            )}
          </div>

          {/* Conditions & Contact Preference */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Rental Conditions
              </label>
              <input
                type="text"
                value={rentalConditions}
                onChange={(e) => setRentalConditions(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Contact Preference
              </label>
              <select
                value={contactPreference}
                onChange={(e) => setContactPreference(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="chat_call">In-App Chat, Audio & Video Call</option>
                <option value="chat_only">In-App Chat Only</option>
                <option value="phone_chat">Phone & In-App Chat</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <span>AZ RENTAL watermark applied server-side</span>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold dark:border-slate-700">
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-xl bg-[#F5A623] px-6 py-2.5 text-xs font-bold text-[#123B65] hover:bg-[#e59816] disabled:opacity-60"
              >
                {submitting ? 'Processing & Watermarking...' : 'Publish Listing'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
