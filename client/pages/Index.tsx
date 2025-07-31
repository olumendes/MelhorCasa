import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Play, Square, Upload, Download, Home, MapPin, Car, Maximize2, Settings, Filter, Heart, ThumbsDown, ArrowUpDown, Target, Tag, Plus, X, Search, ArrowLeft, ArrowRight, Zap, PiggyBank } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import * as XLSX from 'xlsx';

interface Property {
  id: string;
  nome: string;
  imagem: string;
  valor: string;
  m2: string;
  localizacao: string;
  link: string;
  quartos: string;
  garagem: string;
  site?: string;
  // Novos campos para diferentes sites
  vantagens?: string;
  condominio?: string;
  rua?: string;
  bairro?: string;
  palavrasChaves?: string;
  imagem2?: string; // Segunda imagem
  latitude?: number;
  longitude?: number;
  valorNumerico?: number;
  m2Numerico?: number;
  quartosNumerico?: number;
  garagemNumerico?: number;
  distancia?: number;
  tags?: string[];
}

interface UserLocation {
  address: string;
  latitude: number;
  longitude: number;
}

interface Filters {
  valorMin: string;
  valorMax: string;
  m2Min: number;
  m2Max: number;
  quartos: string;
  vagas: string;
  distanciaMax: number;
  tags: string[];
}

interface SortOption {
  field: 'valor' | 'distancia' | 'tamanho';
  direction: 'asc' | 'desc';
}

interface TouchPosition {
  x: number;
  y: number;
}

export default function Index() {
  const [isScrapingActive, setIsScrapingActive] = useState(false);
    const [properties, setProperties] = useState<Property[]>([]);
  const [filteredProperties, setFilteredProperties] = useState<Property[]>([]);
  const [likedProperties, setLikedProperties] = useState<Property[]>([]);
  const [dislikedProperties, setDislikedProperties] = useState<Property[]>([]);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLikedModalOpen, setIsLikedModalOpen] = useState(false);
      const [isMatchModeOpen, setIsMatchModeOpen] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [matchModeProperties, setMatchModeProperties] = useState<Property[]>([]);
  const [matchModeTagInput, setMatchModeTagInput] = useState("");
  const [isMatchModeTagModalOpen, setIsMatchModeTagModalOpen] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);
  const [isSwipeAnimating, setIsSwipeAnimating] = useState(false);
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const [selectedPropertyForTag, setSelectedPropertyForTag] = useState<Property | null>(null);
  const [newTagInput, setNewTagInput] = useState("");
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [tagSearchInput, setTagSearchInput] = useState("");
  const [selectedTagsFilter, setSelectedTagsFilter] = useState<string[]>([]);
  const [showAllProperties, setShowAllProperties] = useState(false);
  const [locationInput, setLocationInput] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>({ field: 'valor', direction: 'desc' });
  const [touchStart, setTouchStart] = useState<TouchPosition | null>(null);
  const [tempFilters, setTempFilters] = useState<Filters>({
    valorMin: "",
    valorMax: "",
    m2Min: 0,
    m2Max: 2000,
    quartos: "all",
    vagas: "all",
    distanciaMax: 100,
    tags: []
  });
  const [filtersApplied, setFiltersApplied] = useState(false);
  const [isSelectSiteOpen, setIsSelectSiteOpen] = useState(false);
  const [selectedSite, setSelectedSite] = useState<string>('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState<{[key: string]: number}>({});
  const [touchEnd, setTouchEnd] = useState<TouchPosition | null>(null);
  const [swipedCard, setSwipedCard] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({
    valorMin: "",
    valorMax: "",
    m2Min: 0,
    m2Max: 2000,
    quartos: "all",
    vagas: "all",
    distanciaMax: 100,
    tags: []
  });
    const fileInputRef = useRef<HTMLInputElement>(null);

  // Function to calculate distance between two coordinates using Haversine formula
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  // Function to get coordinates from address using a geocoding service
  const geocodeAddress = async (address: string): Promise<{lat: number, lng: number} | null> => {
    try {
      // Using a free geocoding service (Nominatim)
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address + ', Brazil')}&limit=1`);
      const data = await response.json();
      if (data && data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon)
        };
      }
    } catch (error) {
      console.error('Geocoding error:', error);
    }
    return null;
  };

  // Function to parse numeric values from strings
  const parseNumericValue = (valueStr: string | number | undefined | null): number => {
    if (valueStr === null || valueStr === undefined) return 0;

    // If it's already a number, return it
    if (typeof valueStr === 'number') return valueStr;

    // Convert to string and handle different formats
    const str = valueStr.toString().trim();
    if (!str || str === '' || str === '-' || str === 'N/A') return 0;

    // Extract only digits, dots and commas
    const cleaned = str.replace(/[^\d.,]/g, '');
    if (!cleaned) return 0;

    // Handle Brazilian number format
    // Examples: 1.200.000 = 1200000, 1.200.000,50 = 1200000.5, 1200000 = 1200000
    let normalizedStr = cleaned;

    // Check if it's Brazilian format with dots as thousand separators
    const dotCount = (cleaned.match(/\./g) || []).length;
    const commaCount = (cleaned.match(/,/g) || []).length;

    if (dotCount > 1 || (dotCount === 1 && commaCount === 1)) {
      // Brazilian format: 1.200.000 or 1.200.000,50
      // Remove dots (thousand separators) and replace comma with dot (decimal)
      normalizedStr = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (dotCount === 1 && commaCount === 0) {
      // Could be: 1200000.50 (English) or 1.200 (Brazilian thousands)
      // Check if dot is followed by 1-2 digits (likely decimal) or 3+ digits (likely thousands)
      const parts = cleaned.split('.');
      if (parts.length === 2 && parts[1].length <= 2) {
        // Likely decimal: 1200000.50
        normalizedStr = cleaned;
      } else {
        // Likely thousands: 1.200 -> 1200
        normalizedStr = cleaned.replace(/\./g, '');
      }
    } else if (dotCount === 0 && commaCount === 1) {
      // Brazilian decimal: 1200000,50 -> 1200000.50
      normalizedStr = cleaned.replace(',', '.');
    } else {
      // Only digits or multiple separators - remove all separators except last
      normalizedStr = cleaned.replace(/[.,]/g, '');
    }

    const parsed = parseFloat(normalizedStr);
    const result = isNaN(parsed) ? 0 : Math.floor(parsed);

    // Debug log para verificar conversões
    if (str !== cleaned && result > 0) {
      console.log(`Converted: "${str}" -> "${cleaned}" -> "${normalizedStr}" -> ${result}`);
    }

    return result;
  };

        // Function to check if property link already exists
  const isDuplicateProperty = (newProperty: Property, existingProperties: Property[]): boolean => {
    return existingProperties.some(existing => existing.link === newProperty.link);
  };

  // Function to check if property already exists in liked or disliked
  const isPropertyAlreadyProcessed = (newProperty: Property): boolean => {
    return isDuplicateProperty(newProperty, likedProperties) || isDuplicateProperty(newProperty, dislikedProperties);
  };

  // Function to remove duplicates from property array based on link
  const removeDuplicateProperties = (properties: Property[]): Property[] => {
    const seen = new Set<string>();
    return properties.filter(property => {
      if (seen.has(property.link)) {
        return false;
      }
      seen.add(property.link);
      return true;
    });
  };

  // Function to enhance property with numeric values and distance
  const enhanceProperty = (property: Property): Property => {
    const enhanced = {
      ...property,
      valorNumerico: parseNumericValue(property.valor || ""),
      m2Numerico: parseNumericValue(property.m2 || ""),
      quartosNumerico: parseNumericValue(property.quartos || ""),
      garagemNumerico: parseNumericValue(property.garagem || "")
    };

    // Add mock coordinates for demonstration (in real app, these would come from geocoding)
    const locations = [
      { lat: -19.9191, lng: -43.9386 }, // Savassi
      { lat: -19.9245, lng: -43.9352 }, // Funcionários
      { lat: -19.8687, lng: -43.9653 }, // Santa Mônica
      { lat: -19.9167, lng: -43.9345 }, // Centro
      { lat: -19.8915, lng: -43.9401 }, // Castelo
      { lat: -19.9542, lng: -43.9542 }, // São Pedro
    ];
    const randomLocation = locations[Math.floor(Math.random() * locations.length)];
    enhanced.latitude = randomLocation.lat;
    enhanced.longitude = randomLocation.lng;

    // Calculate distance if user location is set
    if (userLocation) {
      enhanced.distancia = calculateDistance(
        userLocation.latitude,
        userLocation.longitude,
        enhanced.latitude,
        enhanced.longitude
      );
    }

    return enhanced;
  };

    // Filter properties based on current filters
  const applyFilters = (propertiesToFilter: Property[]) => {
    return propertiesToFilter.filter((property, index) => {
      try {
        // Use existing enhanced values or enhance if not already done
        const enhanced = property.valorNumerico ? property : enhanceProperty(property);

        // Price filter - only apply if values are set and valid
        if (filters.valorMin && filters.valorMin.trim()) {
          const valorMin = parseInt(filters.valorMin.replace(/[^\d]/g, ''));
          if (valorMin > 0 && (!enhanced.valorNumerico || enhanced.valorNumerico < valorMin)) {
            return false;
          }
        }
        if (filters.valorMax && filters.valorMax.trim()) {
          const valorMax = parseInt(filters.valorMax.replace(/[^\d]/g, ''));
          if (valorMax > 0 && (!enhanced.valorNumerico || enhanced.valorNumerico > valorMax)) {
            return false;
          }
        }

        // Size filter - only exclude if property has size data and it's outside range
        const m2Value = enhanced.m2Numerico || 0;
        if (m2Value > 0) {
          if (m2Value < filters.m2Min || m2Value > filters.m2Max) {
            return false;
          }
        }

        // Rooms filter - only apply if not "all" and property has room data
        if (filters.quartos !== "all" && enhanced.quartosNumerico !== undefined) {
          const requiredRooms = parseInt(filters.quartos);
          if (!isNaN(requiredRooms) && enhanced.quartosNumerico !== requiredRooms) {
            return false;
          }
        }

        // Parking filter - only apply if not "all" and property has parking data
        if (filters.vagas !== "all" && enhanced.garagemNumerico !== undefined) {
          const requiredVagas = parseInt(filters.vagas);
          if (!isNaN(requiredVagas) && enhanced.garagemNumerico !== requiredVagas) {
            return false;
          }
        }

        // Distance filter - only apply if user location is set AND property has location
        if (userLocation && enhanced.distancia !== undefined && enhanced.distancia > filters.distanciaMax) {
          return false;
        }

        // Tags filter - only apply if tags are selected
        if (filters.tags.length > 0) {
          if (!property.tags || !filters.tags.some(tag => property.tags!.includes(tag))) {
            return false;
          }
        }

        return true;
      } catch (error) {
        console.error(`Error filtering property ${index}:`, error, property);
        // If there's an error, include the property rather than exclude it
        return true;
      }
    });
  };

  const applyFiltersNow = () => {
    setFilters(tempFilters);
    setFiltersApplied(true);
    toast.info("Filtros aplicados!");
  };

  const resetFilters = () => {
    const resetValues = {
      valorMin: "",
      valorMax: "",
      m2Min: 0,
      m2Max: 2000,
      quartos: "all",
      vagas: "all",
      distanciaMax: 100,
      tags: []
    };
    setTempFilters(resetValues);
    setFilters(resetValues);
    setFiltersApplied(false);
    setShowAllProperties(false);
    toast.info("Filtros resetados!");
  };

      // Update filtered properties when properties or filters change
  useEffect(() => {
    // First deduplicate the properties
    const deduplicatedProperties = removeDuplicateProperties(properties);

    // If duplicates were found, update the state
    if (deduplicatedProperties.length !== properties.length) {
      setProperties(deduplicatedProperties);
      return; // Exit early, will trigger this useEffect again with deduplicated data
    }

    // Enhance properties that don't have numeric values yet
    const enhanced = properties.map(property =>
      property.valorNumerico ? property : enhanceProperty(property)
    );

    // If showAllProperties is true, bypass filtering completely
    const result = showAllProperties ? enhanced : applyFilters(enhanced);
    const sorted = sortProperties(result);

    // Show helpful message if no properties match filters
    if (properties.length > 0 && result.length === 0 && !showAllProperties) {
      console.log('Debug filtering:', {
        totalProperties: properties.length,
        enhancedCount: enhanced.length,
        filteredCount: result.length,
        currentFilters: filters,
        sampleEnhanced: enhanced[0],
        sampleOriginal: properties[0]
      });
    }

    setFilteredProperties(sorted);
  }, [properties, filters, userLocation, sortOption, showAllProperties]);

  // Initialize tempFilters with current filters
  useEffect(() => {
    setTempFilters(filters);
  }, []);

  const handleSaveLocation = async () => {
    if (!locationInput.trim()) {
      toast.error("Por favor, insira um endereço válido");
      return;
    }

    toast.info("Buscando coordenadas do endereço...");
    const coords = await geocodeAddress(locationInput);

    if (coords) {
      const newLocation: UserLocation = {
        address: locationInput,
        latitude: coords.lat,
        longitude: coords.lng
      };
      setUserLocation(newLocation);
      localStorage.setItem('userLocation', JSON.stringify(newLocation));
      setIsSettingsOpen(false);
      toast.success("Localização salva com sucesso!");
    } else {
      toast.error("Não foi possível encontrar as coordenadas para este endereço");
    }
  };

    // Swipe handling functions
  const handleTouchStart = (e: React.TouchEvent, propertyId: string) => {
    setTouchStart({
      x: e.targetTouches[0].clientX,
      y: e.targetTouches[0].clientY
    });
  };

  const handleTouchMove = (e: React.TouchEvent, propertyId: string) => {
    setTouchEnd({
      x: e.targetTouches[0].clientX,
      y: e.targetTouches[0].clientY
    });
  };

    const handleTouchEnd = (propertyId: string) => {
    if (!touchStart || !touchEnd) return;

    const distanceX = touchStart.x - touchEnd.x;
    const distanceY = touchStart.y - touchEnd.y;
    const isLeftSwipe = distanceX > 50;
    const isRightSwipe = distanceX < -50;
    const isVerticalSwipe = Math.abs(distanceY) > Math.abs(distanceX);

    if (!isVerticalSwipe) {
      if (isLeftSwipe) {
        handleDislike(propertyId);
      } else if (isRightSwipe) {
        handleLike(propertyId);
      }
    }

    setTouchStart(null);
    setTouchEnd(null);
  };

  // Tag management functions
  const addTagToProperty = (propertyId: string, tag: string) => {
    setProperties(prev => prev.map(property => {
      if (property.id === propertyId) {
        const currentTags = property.tags || [];
        if (!currentTags.includes(tag)) {
          return { ...property, tags: [...currentTags, tag] };
        }
      }
      return property;
    }));

    // Also update liked properties if this property is liked
    setLikedProperties(prev => prev.map(property => {
      if (property.id === propertyId) {
        const currentTags = property.tags || [];
        if (!currentTags.includes(tag)) {
          const updated = [...prev.filter(p => p.id !== propertyId), { ...property, tags: [...currentTags, tag] }];
          localStorage.setItem('likedProperties', JSON.stringify(updated));
          return { ...property, tags: [...currentTags, tag] };
        }
      }
      return property;
    }));

    // Update available tags
    if (!availableTags.includes(tag)) {
      const newTags = [...availableTags, tag];
      setAvailableTags(newTags);
      localStorage.setItem('availableTags', JSON.stringify(newTags));
    }
  };

  const addNewTag = () => {
    if (newTagInput.trim() && selectedPropertyForTag) {
      addTagToProperty(selectedPropertyForTag.id, newTagInput.trim());
      setNewTagInput("");
      setIsTagModalOpen(false);
      setSelectedPropertyForTag(null);
      toast.success(`Tag "${newTagInput.trim()}" adicionada!`);
    }
  };

  const openTagModal = (property: Property) => {
    setSelectedPropertyForTag(property);
    setIsTagModalOpen(true);
  };

  // Match Mode functions
  const startMatchMode = () => {
    if (filteredProperties.length === 0) {
      toast.error("Nenhuma propriedade disponível para o modo match");
      return;
    }
    setMatchModeProperties([...filteredProperties]);
    setCurrentMatchIndex(0);
    setIsMatchModeOpen(true);
  };

  const handleMatchModeAction = (action: 'like' | 'dislike') => {
    if (currentMatchIndex >= matchModeProperties.length) return;

    const currentProperty = matchModeProperties[currentMatchIndex];

    if (action === 'like') {
      handleLike(currentProperty.id);
    } else {
      handleDislike(currentProperty.id);
    }

    // Remove the property from match mode list
    const updatedMatchProperties = matchModeProperties.filter(p => p.id !== currentProperty.id);
    setMatchModeProperties(updatedMatchProperties);

    // If no more properties, close match mode
    if (updatedMatchProperties.length === 0) {
      setIsMatchModeOpen(false);
      toast.info("Todas as propriedades foram avaliadas!");
      return;
    }

    // Adjust index if necessary and reset position states
    if (currentMatchIndex >= updatedMatchProperties.length) {
      setCurrentMatchIndex(0);
    }

    // Reset touch and animation states to ensure next card appears correctly
    setTouchStart(null);
    setTouchEnd(null);
    setIsSwipeAnimating(false);
    setSwipeDirection(null);
  };

    // Match Mode tag functions
  const addTagInMatchMode = (tag: string) => {
    if (currentMatchIndex >= matchModeProperties.length) return;

    const currentProperty = matchModeProperties[currentMatchIndex];
    addTagToProperty(currentProperty.id, tag);

    // Update the match mode properties array
    setMatchModeProperties(prev => prev.map(prop =>
      prop.id === currentProperty.id
        ? { ...prop, tags: [...(prop.tags || []), tag] }
        : prop
    ));
  };

  const addNewTagInMatchMode = () => {
    if (matchModeTagInput.trim()) {
      addTagInMatchMode(matchModeTagInput.trim());
      setMatchModeTagInput("");
      setIsMatchModeTagModalOpen(false);
      toast.success(`Tag "${matchModeTagInput.trim()}" adicionada!`);
    }
  };

  // Keyboard controls for match mode
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isMatchModeOpen || isMatchModeTagModalOpen) return;

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        handleMatchModeAction('dislike');
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        handleMatchModeAction('like');
      } else if (event.key === 'Escape') {
        setIsMatchModeOpen(false);
      } else if (event.key === 't' || event.key === 'T') {
        event.preventDefault();
        setIsMatchModeTagModalOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMatchModeOpen, isMatchModeTagModalOpen, currentMatchIndex, matchModeProperties]);

  // Reset animation states when card index changes
  useEffect(() => {
    setIsSwipeAnimating(false);
    setSwipeDirection(null);
    setTouchStart(null);
    setTouchEnd(null);
  }, [currentMatchIndex]);

    const handleLike = (propertyId: string) => {
    const property = properties.find(p => p.id === propertyId);
    if (!property) return;

    setSwipedCard(propertyId);
    setTimeout(() => {
      setProperties(prev => prev.filter(p => p.id !== propertyId));
      setLikedProperties(prev => {
        // Check if this property is already liked to prevent duplicates
        if (!isDuplicateProperty(property, prev)) {
          const updated = [...prev, property];
          localStorage.setItem('likedProperties', JSON.stringify(updated));
          return updated;
        }
        return prev;
      });
      setSwipedCard(null);
    }, 300);
  };

  const handleDislike = (propertyId: string) => {
    const property = properties.find(p => p.id === propertyId);
    if (!property) return;

    setSwipedCard(propertyId);
    setTimeout(() => {
      setProperties(prev => prev.filter(p => p.id !== propertyId));
      setDislikedProperties(prev => {
        // Check if this property is already disliked to prevent duplicates
        if (!isDuplicateProperty(property, prev)) {
          const updated = [...prev, property];
          localStorage.setItem('dislikedProperties', JSON.stringify(updated));
          return updated;
        }
        return prev;
      });
      setSwipedCard(null);
    }, 300);
  };

  // Sorting function
  const sortProperties = (propertiesToSort: Property[]): Property[] => {
    if (!propertiesToSort || propertiesToSort.length === 0) return [];

    return [...propertiesToSort].sort((a, b) => {
      let aValue: number, bValue: number;

      switch (sortOption.field) {
        case 'valor':
          aValue = a.valorNumerico || 0;
          bValue = b.valorNumerico || 0;
          break;
        case 'distancia':
          aValue = a.distancia || 999;
          bValue = b.distancia || 999;
          break;
        case 'tamanho':
          aValue = a.m2Numerico || 0;
          bValue = b.m2Numerico || 0;
          break;
        default:
          return 0;
      }

      const result = sortOption.direction === 'asc' ? aValue - bValue : bValue - aValue;

      // Debug ordenação
      if (sortOption.field === 'valor' && Math.random() < 0.1) {
        console.log(`Sorting: ${a.nome}(${aValue}) vs ${b.nome}(${bValue}) = ${result} (${sortOption.direction})`);
      }

      return result;
    });

    // Log final para debug
    console.log(`Ordenação ${sortOption.field} ${sortOption.direction} aplicada. Total: ${sorted.length} propriedades`);

    return sorted;
  };

      // Load user location and liked/disliked properties from localStorage on component mount
  useEffect(() => {
    const savedLocation = localStorage.getItem('userLocation');
    const savedLiked = localStorage.getItem('likedProperties');
    const savedDisliked = localStorage.getItem('dislikedProperties');
    const savedTags = localStorage.getItem('availableTags');

    if (savedLocation) {
      try {
        setUserLocation(JSON.parse(savedLocation));
      } catch (error) {
        console.error('Error loading saved location:', error);
      }
    }

    if (savedLiked) {
      try {
        const likedData = JSON.parse(savedLiked);
        const deduplicatedLiked = removeDuplicateProperties(likedData);
        setLikedProperties(deduplicatedLiked);

        // Update localStorage if duplicates were found
        if (deduplicatedLiked.length !== likedData.length) {
          localStorage.setItem('likedProperties', JSON.stringify(deduplicatedLiked));
          console.log(`Removed ${likedData.length - deduplicatedLiked.length} duplicate liked properties`);
        }
      } catch (error) {
        console.error('Error loading liked properties:', error);
      }
    }

    if (savedDisliked) {
      try {
        const dislikedData = JSON.parse(savedDisliked);
        const deduplicatedDisliked = removeDuplicateProperties(dislikedData);
        setDislikedProperties(deduplicatedDisliked);

        // Update localStorage if duplicates were found
        if (deduplicatedDisliked.length !== dislikedData.length) {
          localStorage.setItem('dislikedProperties', JSON.stringify(deduplicatedDisliked));
          console.log(`Removed ${dislikedData.length - deduplicatedDisliked.length} duplicate disliked properties`);
        }
      } catch (error) {
        console.error('Error loading disliked properties:', error);
      }
    }

    if (savedTags) {
      try {
        setAvailableTags(JSON.parse(savedTags));
      } catch (error) {
        console.error('Error loading available tags:', error);
      }
    }
  }, []);

  const handleStartScraping = () => {
    setIsScrapingActive(true);
    toast.success("Scraping iniciado! Coletando dados do QuintoAndar...");
    
        // Simulate real scraping process with real-looking data
    setTimeout(() => {
      const newProperty1 = {
        id: Date.now().toString(),
        nome: "Casa 3 dormitórios em Belo Horizonte",
        imagem: "https://cdn.builder.io/api/v1/image/assets%2FTEMP%2Fc8f3f77e6bb0405a8c0c5e2f4e2f6e8d",
        valor: "R$ 890.000",
        m2: "195 m²",
        localizacao: "Castelo, Belo Horizonte - MG",
        link: "https://www.quintoandar.com.br/comprar/imovel/casa-castelo-belo-horizonte",
        quartos: "3 quartos",
        garagem: "2"
      };

            setProperties(prev => {
        if (!isDuplicateProperty(newProperty1, prev) && !isPropertyAlreadyProcessed(newProperty1)) {
          toast.info("Encontrada nova propriedade!");
          // Reset filters when adding new properties to ensure they are visible
          setTimeout(() => {
            setFilters({
              valorMin: "",
              valorMax: "",
              m2Min: 0,
              m2Max: 2000,
              quartos: "all",
              vagas: "all",
              distanciaMax: 100,
              tags: []
            });
          }, 100);
          return [...prev, newProperty1];
        } else {
          toast.info("Propriedade já existe ou foi processada, pulando duplicata");
          return prev;
        }
      });
    }, 3000);

    // Add more realistic properties over time
    setTimeout(() => {
      const newProperty2 = {
        id: (Date.now() + 1).toString(),
        nome: "Sobrado moderno com área gourmet",
        imagem: "https://cdn.builder.io/api/v1/image/assets%2FTEMP%2Fb2e4f88a7cc0405a8c0c5e2f4e2f6e8f",
        valor: "R$ 1.150.000",
        m2: "220 m²",
        localizacao: "São Pedro, Belo Horizonte - MG",
        link: "https://www.quintoandar.com.br/comprar/imovel/sobrado-sao-pedro-belo-horizonte",
        quartos: "4 quartos",
        garagem: "3"
      };

            setProperties(prev => {
        if (!isDuplicateProperty(newProperty2, prev) && !isPropertyAlreadyProcessed(newProperty2)) {
          toast.info("Encontrada nova propriedade!");
          return [...prev, newProperty2];
        } else {
          toast.info("Propriedade já existe ou foi processada, pulando duplicata");
          return prev;
        }
      });
    }, 6000);
  };

  const handleStopScraping = () => {
    setIsScrapingActive(false);
    toast.info("Scraping pausado.");
  };

  // Site mappings for different XLSX structures
  const siteColumnMappings = {
    quintoandar: {
      nome: ['Nome', 'nome', 'Título', 'titulo'],
      imagem: ['Imagem', 'imagem', 'Foto', 'foto'],
      valor: ['Valor', 'valor', 'Preço', 'preco'],
      m2: ['M²', 'm2', 'Area', 'area'],
      localizacao: ['Localização', 'localizacao', 'Endereço', 'endereco'],
      link: ['Link', 'link', 'URL', 'url'],
      quartos: ['Quartos', 'quartos'],
      garagem: ['Garagem', 'garagem', 'Vagas', 'vagas'],
      site: ['Site', 'site']
    },
    imovelnaweb: {
      nome: ['Titulo', 'titulo', 'Título', 'Nome', 'nome'],
      imagem: ['Imagem1', 'imagem1', 'Imagem', 'imagem'],
      imagem2: ['Imagem2', 'imagem2'],
      valor: ['Preço', 'Preco', 'preco', 'Valor', 'valor'],
      condominio: ['Condominio', 'condominio', 'Condomínio'],
      m2: ['Area', 'area', 'Área', 'área', 'M²', 'm2'],
      rua: ['Rua', 'rua', 'Endereço', 'endereco'],
      bairro: ['Bairro', 'bairro'],
      localizacao: ['Localização', 'localizacao', 'Endereço', 'endereco'],
      link: ['Link', 'link', 'URL', 'url'],
      quartos: ['Quartos', 'quartos'],
      garagem: ['Garagem', 'garagem', 'Vagas', 'vagas'],
      vantagens: ['Vantagens', 'vantagens'],
      palavrasChaves: ['PalavrasChaves', 'palavraschaves', 'Palavras-chave', 'Keywords'],
      site: ['Site', 'site']
    },
    olx: {
      nome: ['Título', 'titulo', 'Nome', 'nome'],
      imagem: ['Imagem', 'imagem', 'Foto', 'foto'],
      valor: ['Preço', 'preco', 'Valor', 'valor'],
      m2: ['Tamanho', 'tamanho', 'M²', 'm2'],
      localizacao: ['Localização', 'localizacao', 'Cidade', 'cidade'],
      link: ['Link', 'link', 'URL', 'url'],
      quartos: ['Quartos', 'quartos'],
      garagem: ['Garagem', 'garagem'],
      site: ['Site', 'site']
    },
    zapimoveis: {
      nome: ['Título', 'titulo', 'Nome', 'nome'],
      imagem: ['Imagem', 'imagem'],
      valor: ['Valor', 'valor', 'Preço', 'preco'],
      m2: ['Área', 'area', 'M²', 'm2'],
      localizacao: ['Endereço', 'endereco', 'Localização', 'localizacao'],
      link: ['Link', 'link'],
      quartos: ['Quartos', 'quartos'],
      garagem: ['Vagas', 'vagas', 'Garagem', 'garagem'],
      site: ['Site', 'site']
    },
    vivareal: {
      nome: ['Título', 'titulo', 'Nome', 'nome'],
      imagem: ['Foto', 'foto', 'Imagem', 'imagem'],
      valor: ['Preço', 'preco', 'Valor', 'valor'],
      m2: ['Área útil', 'area', 'M²', 'm2'],
      localizacao: ['Endereço', 'endereco', 'Localização', 'localizacao'],
      link: ['Link', 'link'],
      quartos: ['Quartos', 'quartos'],
      garagem: ['Vagas', 'vagas'],
      site: ['Site', 'site']
    },
    netimoveis: {
      nome: ['Título', 'titulo', 'Nome', 'nome'],
      imagem: ['Imagem', 'imagem', 'Foto', 'foto'],
      valor: ['Valor', 'valor', 'Preço', 'preco'],
      m2: ['Área', 'area', 'M²', 'm2'],
      localizacao: ['Endereço', 'endereco', 'Localização', 'localizacao'],
      link: ['Link', 'link', 'URL', 'url'],
      quartos: ['Quartos', 'quartos'],
      garagem: ['Garagem', 'garagem', 'Vagas', 'vagas'],
      site: ['Site', 'site']
    },
    loft: {
      nome: ['Título', 'titulo', 'Nome', 'nome'],
      imagem: ['Imagem', 'imagem'],
      valor: ['Preço', 'preco', 'Valor', 'valor'],
      m2: ['Área', 'area', 'M²', 'm2'],
      localizacao: ['Endereço', 'endereco'],
      link: ['Link', 'link'],
      quartos: ['Quartos', 'quartos'],
      garagem: ['Vagas', 'vagas'],
      site: ['Site', 'site']
    },
    chavesnamao: {
      nome: ['Título', 'titulo', 'Descrição', 'descricao'],
      imagem: ['Foto', 'foto', 'Imagem', 'imagem'],
      valor: ['Valor', 'valor', 'Preço', 'preco'],
      m2: ['Área', 'area', 'Tamanho', 'tamanho'],
      localizacao: ['Localização', 'localizacao', 'Endereço', 'endereco'],
      link: ['Link', 'link'],
      quartos: ['Quartos', 'quartos'],
      garagem: ['Garagem', 'garagem'],
      site: ['Site', 'site']
    },
    casamineira: {
      nome: ['Título', 'titulo', 'Nome', 'nome'],
      imagem: ['Imagem', 'imagem', 'Foto', 'foto'],
      valor: ['Preço', 'preco', 'Valor', 'valor'],
      m2: ['Área', 'area', 'M²', 'm2'],
      rua: ['Rua', 'rua', 'Endereço', 'endereco'],
      bairro: ['Bairro', 'bairro'],
      localizacao: ['Localização', 'localizacao'],
      link: ['Link', 'link'],
      quartos: ['Quartos', 'quartos'],
      garagem: ['Garagem', 'garagem', 'Vagas', 'vagas'],
      site: ['Site', 'site']
    }
  };

  const getColumnValue = (row: any, mapping: string[], fieldName = ''): string => {
    if (!mapping || mapping.length === 0) return '';

    // Debug: log available columns for first property
    if (fieldName === 'nome' && Math.random() < 0.1) {
      console.log(`=== DEBUG ${fieldName} ===`);
      console.log('Available columns:', Object.keys(row));
      console.log('Looking for:', mapping);
    }

    for (const column of mapping) {
      if (row[column] !== undefined && row[column] !== null && row[column] !== '') {
        let value = row[column].toString().trim();
        if (value && value !== 'N/A' && value !== '-') {

          // Special processing for nome field
          if (fieldName === 'nome') {
            // Remove HTML tags and entities
            value = value.replace(/<[^>]*>/g, '');
            value = value.replace(/&amp;lt;/g, '<').replace(/&amp;gt;/g, '>');
            value = value.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            value = value.replace(/&nbsp;/g, ' ');
            value = value.replace(/&quot;/g, '"');
            value = value.replace(/&amp;/g, '&');

            // Remove extra whitespace
            value = value.replace(/\s+/g, ' ').trim();

            // Extract meaningful title - look for patterns
            // Try to find the actual property title before description
            const patterns = [
              /^([^–-]+)[–-]/, // Title before dash
              /^([^.!?]+)[.!?]/, // First sentence
              /^(.{1,100})\s+(Características|Detalhes|Localização|Com\s+\d+)/, // Before common description words
            ];

            for (const pattern of patterns) {
              const match = value.match(pattern);
              if (match && match[1] && match[1].trim().length > 10) {
                value = match[1].trim();
                break;
              }
            }

            // Limit to 120 characters for better display
            if (value.length > 120) {
              value = value.substring(0, 117) + '...';
            }
          }

          // Only log first few items to avoid spam
          if ((fieldName === 'nome' || fieldName === 'valor' || fieldName === 'imagem') && Math.random() < 0.1) {
            console.log(`Found ${fieldName}: "${value.substring(0, 50)}..." in column "${column}"`);
          }
          return value;
        }
      }
    }

    // Only log missing critical fields
    if ((fieldName === 'nome' || fieldName === 'valor') && Math.random() < 0.2) {
      console.log(`No ${fieldName} found in columns:`, mapping);
    }
    return '';
  };

  // Initialize image index for new properties
  const initializeImageIndex = (properties: Property[]) => {
    const newIndexes: {[key: string]: number} = {};
    properties.forEach(prop => {
      if (!currentImageIndex[prop.id]) {
        newIndexes[prop.id] = 0;
      }
    });
    if (Object.keys(newIndexes).length > 0) {
      setCurrentImageIndex(prev => ({ ...prev, ...newIndexes }));
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
      setPendingFile(file);
      setIsSelectSiteOpen(true);
    } else {
      toast.error("Por favor, selecione um arquivo Excel (.xlsx ou .xls)");
    }

    // Reset input value
    if (event.target) {
      event.target.value = '';
    }
  };

  const processSelectedFile = () => {
    if (!pendingFile || !selectedSite) return;

    const mapping = siteColumnMappings[selectedSite as keyof typeof siteColumnMappings];
    if (!mapping) {
      toast.error("Site não suportado");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

        // Convert Excel data using site-specific mapping
        const importedProperties: Property[] = jsonData.map((row, index) => ({
          id: `imported-${Date.now()}-${index}`,
          nome: getColumnValue(row, mapping.nome, 'nome') || `Imóvel Importado ${index + 1}`,
          imagem: getColumnValue(row, mapping.imagem, 'imagem') ||
                  getColumnValue(row, ['Imagem', 'imagem', 'Foto', 'foto', 'Image', 'image'], 'imagem-fallback') ||
                  "https://cdn.builder.io/api/v1/image/assets%2FTEMP%2Fdefault-house",
          imagem2: getColumnValue(row, mapping.imagem2 || [], 'imagem2'),
          valor: getColumnValue(row, mapping.valor, 'valor') || "R$ 0",
          condominio: getColumnValue(row, mapping.condominio || [], 'condominio'),
          m2: getColumnValue(row, mapping.m2, 'm2') || "0 m²",
          rua: getColumnValue(row, mapping.rua || [], 'rua'),
          bairro: getColumnValue(row, mapping.bairro || [], 'bairro'),
          localizacao: getColumnValue(row, mapping.localizacao, 'localizacao') ||
                      `${getColumnValue(row, mapping.rua || [], 'rua')} ${getColumnValue(row, mapping.bairro || [], 'bairro')}`.trim() ||
                      "Localização não informada",
          link: getColumnValue(row, mapping.link, 'link') || "#",
          quartos: getColumnValue(row, mapping.quartos, 'quartos') || "0 quartos",
          garagem: getColumnValue(row, mapping.garagem, 'garagem') || "0",
          vantagens: getColumnValue(row, mapping.vantagens || [], 'vantagens'),
          palavrasChaves: getColumnValue(row, mapping.palavrasChaves || [], 'palavrasChaves'),
          site: getColumnValue(row, mapping.site, 'site') || selectedSite
        }));

        // Filter out duplicates and already processed properties
        setProperties(prev => {
          const newProperties = importedProperties.filter(newProp =>
            !isDuplicateProperty(newProp, prev) && !isPropertyAlreadyProcessed(newProp)
          );

          // Enhance imported properties with numeric values
          const enhancedNewProperties = newProperties.map(property => enhanceProperty(property));

          // Initialize image indexes for new properties
          initializeImageIndex(enhancedNewProperties);

          const duplicatesCount = importedProperties.length - newProperties.length;

          if (duplicatesCount > 0) {
            toast.info(`${newProperties.length} novos imóveis importados do ${selectedSite}, ${duplicatesCount} duplicatas/já processadas ignoradas`);
          } else {
            toast.success(`${newProperties.length} imóveis importados do ${selectedSite}!`);
          }

          // Reset filters and activate show all mode after import
          if (newProperties.length > 0) {
            setTimeout(() => {
              resetFilters();
              setShowAllProperties(true);
            }, 100);
          }

          return [...prev, ...enhancedNewProperties];
        });

        // Close modal and reset
        setIsSelectSiteOpen(false);
        setSelectedSite('');
        setPendingFile(null);

      } catch (error) {
        toast.error("Erro ao processar o arquivo Excel. Verifique o formato.");
        console.error("Error parsing Excel file:", error);
      }
    };
    reader.readAsArrayBuffer(pendingFile);
  };

  const handleExportData = () => {
    // Create worksheet from properties data
    const exportData = properties.map(property => ({
      Nome: property.nome,
      Imagem: property.imagem,
      Imagem2: property.imagem2 || '',
      Valor: property.valor,
      Condominio: property.condominio || '',
      "M²": property.m2,
      Rua: property.rua || '',
      Bairro: property.bairro || '',
      "Localização": property.localizacao,
      Link: property.link,
      Quartos: property.quartos,
      Garagem: property.garagem,
      Vantagens: property.vantagens || '',
      PalavrasChaves: property.palavrasChaves || '',
      Site: property.site || 'QuintoAndar'
    }));
    
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Imóveis");
    
    // Generate Excel file and download
    XLSX.writeFile(workbook, `imoveis_quintoandar_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success("Dados exportados para Excel com sucesso!");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-50">
        <div className="container mx-auto px-3 sm:px-6 py-3 sm:py-4">
          <div className="space-y-3">
            {/* Logo and title row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="p-1.5 sm:p-2 bg-blue-600 rounded-lg">
                  <Home className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                </div>
                <div>
                  <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900">Melhor Casa</h1>
                  <p className="text-xs sm:text-sm text-gray-600 hidden xs:block">Ferramenta elegante para coleta de imóveis</p>
                </div>
              </div>
            </div>

            {/* Navigation buttons - optimized for mobile */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex gap-1.5 sm:gap-2">
              {/* Row 1: Primary actions */}
              <div className="col-span-2 sm:col-span-1 lg:contents">
                <Button
                  onClick={startMatchMode}
                  variant="default"
                  size="sm"
                  className="gap-1 sm:gap-2 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 w-full lg:w-auto"
                  disabled={filteredProperties.length === 0}
                >
                  <Zap className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="text-xs sm:text-sm">Match</span>
                </Button>
              </div>

              <Link to="/casas-com-tags" className="w-full lg:w-auto">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 sm:gap-2 w-full lg:w-auto justify-start lg:justify-center text-xs sm:text-sm"
                >
                  <Tag className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="truncate">Tags</span>
                  {(likedProperties.length + dislikedProperties.length) > 0 && (
                    <Badge variant="secondary" className="ml-auto lg:ml-1 text-xs">
                      {likedProperties.length + dislikedProperties.length}
                    </Badge>
                  )}
                </Button>
              </Link>

              <Link to="/cofrinho" className="w-full lg:w-auto">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 sm:gap-2 w-full lg:w-auto justify-start lg:justify-center text-xs sm:text-sm"
                >
                  <PiggyBank className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="truncate">Cofrinho</span>
                  {likedProperties.length > 0 && (
                    <Badge variant="secondary" className="ml-auto lg:ml-1 text-xs">
                      {likedProperties.length}
                    </Badge>
                  )}
                </Button>
              </Link>

              <Link to="/dislikes" className="w-full lg:w-auto">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 sm:gap-2 w-full lg:w-auto justify-start lg:justify-center text-xs sm:text-sm"
                >
                  <ThumbsDown className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="truncate">Rejeitadas</span>
                  {dislikedProperties.length > 0 && (
                    <Badge variant="destructive" className="ml-auto lg:ml-1 text-xs">
                      {dislikedProperties.length}
                    </Badge>
                  )}
                </Button>
              </Link>

              <Dialog open={isLikedModalOpen} onOpenChange={setIsLikedModalOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 flex-1 sm:flex-none"
                  >
                    <Heart className="h-4 w-4" />
                    <span className="hidden sm:inline">Curtidas</span>
                    <span className="sm:hidden">Curtidas</span>
                    {likedProperties.length > 0 && (
                      <Badge variant="secondary" className="ml-1 text-xs">
                        {likedProperties.length}
                      </Badge>
                    )}
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-hidden">
                  <DialogHeader>
                    <DialogTitle>Casas Curtidas ❤��</DialogTitle>
                  </DialogHeader>
                  <div className="overflow-y-auto max-h-[60vh] space-y-4">
                    {likedProperties.length === 0 ? (
                      <div className="text-center py-8">
                        <Heart className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-600">Nenhuma casa curtida ainda</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {likedProperties.map((property) => (
                          <Card key={property.id} className="overflow-hidden">
                            <div className="relative">
                              <img
                                src={property.imagem}
                                alt={property.nome}
                                className="w-full h-32 object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=400&h=300&fit=crop";
                                }}
                              />
                            </div>
                            <CardContent className="p-4">
                              <h4 className="font-semibold text-sm mb-2 line-clamp-1">{property.nome}</h4>
                              <p className="text-lg font-bold text-green-600 mb-2">{property.valor}</p>
                              <div className="flex gap-1 mb-3">
                                <Badge variant="secondary" className="text-xs">{property.m2}</Badge>
                                <Badge variant="secondary" className="text-xs">{property.quartos}</Badge>
                                <Badge variant="secondary" className="text-xs">{property.garagem} vagas</Badge>
                              </div>
                              <Button
                                size="sm"
                                onClick={() => window.open(property.link, '_blank')}
                                className="w-full"
                              >
                                Ver Detalhes
                              </Button>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 flex-1 sm:flex-none"
                  >
                    <Settings className="h-4 w-4" />
                    <span className="hidden sm:inline">Configurações</span>
                    <span className="sm:hidden">Config</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Configurações de Localização</DialogTitle>
                    <DialogDescription>
                      Configure sua localização para calcular distâncias dos imóveis
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="location">Minha Localização</Label>
                      <Input
                        id="location"
                        placeholder="Ex: Rua das Flores, 123, Savassi, Belo Horizonte - MG"
                        value={locationInput}
                        onChange={(e) => setLocationInput(e.target.value)}
                      />
                      {userLocation && (
                        <p className="text-sm text-gray-600">
                          Localização atual: {userLocation.address}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-3">
                      <Button onClick={handleSaveLocation} className="flex-1">
                        Salvar Localização
                      </Button>
                      <Button variant="outline" onClick={() => setIsSettingsOpen(false)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>

              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="gap-2 flex-1 sm:flex-none"
              >
                <Upload className="h-4 w-4" />
                <span className="hidden sm:inline">Importar Excel</span>
                <span className="sm:hidden">Import</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportData}
                className="gap-2 flex-1 sm:flex-none"
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Exportar Dados</span>
                <span className="sm:hidden">Export</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Controls */}
      <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <Card className="mb-8 bg-white/60 backdrop-blur-sm">
          <CardHeader>
                        <CardTitle className="text-xl">Procura</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Button
                onClick={handleStartScraping}
                disabled={isScrapingActive}
                className="gap-2 bg-green-600 hover:bg-green-700"
              >
                <Play className="h-4 w-4" />
                                {isScrapingActive ? "Scraping Ativo..." : "Iniciar "}
              </Button>
              
              <Button
                onClick={handleStopScraping}
                disabled={!isScrapingActive}
                variant="destructive"
                className="gap-2"
              >
                <Square className="h-4 w-4" />
                                Parar
              </Button>

              <div className="flex items-center gap-2 ml-auto">
                <div className={`w-3 h-3 rounded-full ${isScrapingActive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                <span className="text-sm text-gray-600">
                  Status: {isScrapingActive ? "Coletando dados..." : "Pausado"}
                </span>
              </div>
            </div>
          </CardContent>
                </Card>

                {/* Filters */}
        <Card className="mb-6 sm:mb-8 bg-white/60 backdrop-blur-sm">
          <CardHeader className="pb-3 sm:pb-6">
            <CardTitle className="text-lg sm:text-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="hidden sm:inline">Filtros e Ordenação</span>
                <span className="sm:hidden">Filtros</span>
              </div>
              <Select value={`${sortOption.field}-${sortOption.direction}`} onValueChange={(value) => {
                const [field, direction] = value.split('-') as [SortOption['field'], SortOption['direction']];
                setSortOption({ field, direction });
              }}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="valor-desc">
                    <div className="flex items-center gap-2">
                      <ArrowUpDown className="h-4 w-4" />
                      Maior Valor
                    </div>
                  </SelectItem>
                  <SelectItem value="valor-asc">
                    <div className="flex items-center gap-2">
                      <ArrowUpDown className="h-4 w-4" />
                      Menor Valor
                    </div>
                  </SelectItem>
                  <SelectItem value="tamanho-desc">
                    <div className="flex items-center gap-2">
                      <ArrowUpDown className="h-4 w-4" />
                      Maior Tamanho
                    </div>
                  </SelectItem>
                  <SelectItem value="tamanho-asc">
                    <div className="flex items-center gap-2">
                      <ArrowUpDown className="h-4 w-4" />
                      Menor Tamanho
                    </div>
                  </SelectItem>
                  {userLocation && (
                    <>
                      <SelectItem value="distancia-asc">
                        <div className="flex items-center gap-2">
                          <ArrowUpDown className="h-4 w-4" />
                          Mais Próximo
                        </div>
                      </SelectItem>
                      <SelectItem value="distancia-desc">
                        <div className="flex items-center gap-2">
                          <ArrowUpDown className="h-4 w-4" />
                          Mais Distante
                        </div>
                      </SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 sm:px-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {/* Price Filter */}
              <div className="space-y-2 sm:space-y-3">
                <Label className="text-sm font-medium">Valor (R$)</Label>
                <div className="space-y-2">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      placeholder="Mínimo"
                      value={tempFilters.valorMin}
                      onChange={(e) => setTempFilters(prev => ({ ...prev, valorMin: e.target.value }))}
                      className="flex-1 text-sm"
                    />
                    <Input
                      placeholder="Máximo"
                      value={tempFilters.valorMax}
                      onChange={(e) => setTempFilters(prev => ({ ...prev, valorMax: e.target.value }))}
                      className="flex-1 text-sm"
                    />
                  </div>
                  <div className="text-xs text-gray-600 text-center">
                    Ex: 500000
                  </div>
                </div>
              </div>

              {/* Size Filter */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Tamanho (m²)</Label>
                <div className="space-y-2">
                  <Slider
                    value={[tempFilters.m2Min, tempFilters.m2Max]}
                    onValueChange={([min, max]) =>
                      setTempFilters(prev => ({ ...prev, m2Min: min, m2Max: max }))
                    }
                    max={2000}
                    min={0}
                    step={10}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>{tempFilters.m2Min} m²</span>
                    <span>{tempFilters.m2Max} m²</span>
                  </div>
                </div>
              </div>

              {/* Distance Filter */}
              {userLocation && (
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Distância máxima (km)</Label>
                  <div className="space-y-2">
                    <Slider
                      value={[tempFilters.distanciaMax]}
                      onValueChange={([max]) =>
                        setTempFilters(prev => ({ ...prev, distanciaMax: max }))
                      }
                      max={200}
                      min={1}
                      step={1}
                      className="w-full"
                    />
                    <div className="text-xs text-gray-600 text-center">
                      Até {tempFilters.distanciaMax} km da sua localização
                    </div>
                  </div>
                </div>
              )}

              {/* Rooms Filter */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Quartos</Label>
                <Select value={tempFilters.quartos} onValueChange={(value) =>
                  setTempFilters(prev => ({ ...prev, quartos: value }))
                }>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="1">1 quarto</SelectItem>
                    <SelectItem value="2">2 quartos</SelectItem>
                    <SelectItem value="3">3 quartos</SelectItem>
                    <SelectItem value="4">4 quartos</SelectItem>
                    <SelectItem value="5">5+ quartos</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Parking Filter */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Vagas de Garagem</Label>
                <Select value={tempFilters.vagas} onValueChange={(value) =>
                  setTempFilters(prev => ({ ...prev, vagas: value }))
                }>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="0">Sem vaga</SelectItem>
                    <SelectItem value="1">1 vaga</SelectItem>
                    <SelectItem value="2">2 vagas</SelectItem>
                    <SelectItem value="3">3 vagas</SelectItem>
                    <SelectItem value="4">4+ vagas</SelectItem>
                  </SelectContent>
                </Select>
              </div>

                                          {/* Tags Filter */}
              <div className="space-y-3 md:col-span-2">
                <Label className="text-sm font-medium">Filtrar por Tags</Label>
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1 min-h-[2rem] p-2 border rounded-md bg-white">
                    {tempFilters.tags.length === 0 ? (
                      <span className="text-sm text-gray-400">Selecione tags para filtrar</span>
                    ) : (
                      tempFilters.tags.map(tag => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="cursor-pointer hover:bg-red-100"
                          onClick={() => setTempFilters(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }))}
                        >
                          {tag} <X className="h-3 w-3 ml-1" />
                        </Badge>
                      ))
                    )}
                  </div>
                  {availableTags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {availableTags.filter(tag => !tempFilters.tags.includes(tag)).map(tag => (
                        <Badge
                          key={tag}
                          variant="outline"
                          className="cursor-pointer hover:bg-blue-50"
                          onClick={() => setTempFilters(prev => ({ ...prev, tags: [...prev.tags, tag] }))}
                        >
                          <Plus className="h-3 w-3 mr-1" /> {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>

                            {/* Filter Action Buttons */}
              <div className="space-y-3 flex flex-col items-end md:col-span-full lg:col-span-1">
                <div className="flex flex-col gap-2 w-full">
                  <Button
                    onClick={applyFiltersNow}
                    className="w-full bg-blue-600 hover:bg-blue-700"
                    disabled={JSON.stringify(tempFilters) === JSON.stringify(filters)}
                  >
                    Aplicar Filtros
                  </Button>
                  <Button
                    variant="outline"
                    onClick={resetFilters}
                    className="w-full"
                  >
                    Resetar Filtros
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="bg-white/60 backdrop-blur-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total de Imóveis</p>
                                    <p className="text-3xl font-bold text-blue-600">
                    {filteredProperties.length}
                    {filteredProperties.length !== properties.length &&
                      <span className="text-lg text-gray-500">/{properties.length}</span>
                    }
                  </p>
                  {filteredProperties.length === 0 && properties.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          resetFilters();
                        }}
                        className="text-xs w-full"
                      >
                        Resetar Filtros
                      </Button>
                      <Button
                        size="sm"
                        variant={showAllProperties ? "default" : "outline"}
                        onClick={() => {
                          setShowAllProperties(!showAllProperties);
                          toast.info(showAllProperties ? "Filtros ativados" : "Mostrando todas as propriedades");
                        }}
                        className="text-xs w-full"
                      >
                        {showAllProperties ? "Ativar Filtros" : "Mostrar Todas"}
                      </Button>
                    </div>
                  )}
                </div>
                <Home className="h-8 w-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-white/60 backdrop-blur-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Fontes</p>
                  {(() => {
                    const uniqueSites = [...new Set(properties.map(p => p.site || 'QuintoAndar'))];
                    if (uniqueSites.length === 1) {
                      return <p className="text-xl font-bold text-purple-600">{uniqueSites[0]}</p>;
                    } else if (uniqueSites.length <= 3) {
                      return <p className="text-sm font-bold text-purple-600">{uniqueSites.join(', ')}</p>;
                    } else {
                      return <p className="text-sm font-bold text-purple-600">{uniqueSites.length} sites diferentes</p>;
                    }
                  })()}
                </div>
                <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center">
                  <span className="text-white font-bold text-sm">{[...new Set(properties.map(p => p.site || 'QuintoAndar'))].length}</span>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-white/60 backdrop-blur-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Última Atualização</p>
                  <p className="text-lg font-bold text-green-600">
                    {properties.length > 0 ? "Agora há pouco" : "Nenhuma"}
                  </p>
                </div>
                <div className={`w-3 h-3 rounded-full ${properties.length > 0 ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
              </div>
            </CardContent>
          </Card>
        </div>

                        {/* Properties Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {filteredProperties.map((property) => (
            <Card
              key={property.id}
              className={`overflow-hidden bg-white/80 backdrop-blur-sm hover:shadow-lg transition-all duration-300 hover:scale-[1.02] relative
                ${swipedCard === property.id ? 'transform scale-95 opacity-50' : ''}
              `}
              onTouchStart={(e) => handleTouchStart(e, property.id)}
              onTouchMove={(e) => handleTouchMove(e, property.id)}
              onTouchEnd={() => handleTouchEnd(property.id)}
            >
              <div className="relative">
                <img
                  src={currentImageIndex[property.id] === 1 && property.imagem2 ? property.imagem2 : property.imagem}
                  alt={property.nome}
                  className="w-full h-48 object-cover cursor-pointer"
                  onClick={() => {
                    if (property.imagem2) {
                      setCurrentImageIndex(prev => ({
                        ...prev,
                        [property.id]: prev[property.id] === 1 ? 0 : 1
                      }));
                    }
                  }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=400&h=300&fit=crop";
                  }}
                />
                <Badge className="absolute top-3 right-3 bg-blue-600">
                  {property.site || 'QuintoAndar'}
                </Badge>
                {property.imagem2 && (
                  <div className="absolute bottom-3 right-3 flex gap-1">
                    <div className={`w-2 h-2 rounded-full ${currentImageIndex[property.id] === 0 ? 'bg-white' : 'bg-white/50'}`} />
                    <div className={`w-2 h-2 rounded-full ${currentImageIndex[property.id] === 1 ? 'bg-white' : 'bg-white/50'}`} />
                  </div>
                )}
              </div>
              
              <CardContent className="p-3 sm:p-4 md:p-6">
                <h3 className="font-bold text-base sm:text-lg text-gray-900 mb-2 line-clamp-2">
                  {property.nome}
                </h3>

                <div className="flex items-start gap-2 mb-3">
                  <MapPin className="h-3 w-3 sm:h-4 sm:w-4 text-gray-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs sm:text-sm text-gray-600 line-clamp-2">{property.localizacao}</p>
                </div>

                <div className="text-lg sm:text-xl md:text-2xl font-bold text-green-600 mb-2">
                  {property.valor}
                </div>

                {/* Condomínio */}
                {property.condominio && (
                  <div className="text-sm text-gray-600 mb-3">
                    <span className="font-medium">Condomínio:</span> {property.condominio}
                  </div>
                )}

                {/* Endereço detalhado se disponível */}
                {(property.rua || property.bairro) && (
                  <div className="flex items-start gap-2 mb-3">
                    <MapPin className="h-3 w-3 sm:h-4 sm:w-4 text-gray-500 mt-0.5 flex-shrink-0" />
                    <div className="text-xs sm:text-sm text-gray-600">
                      {property.rua && <p>{property.rua}</p>}
                      {property.bairro && <p>{property.bairro}</p>}
                    </div>
                  </div>
                )}
                
                                                <div className="flex flex-wrap gap-2 mb-4">
                  <Badge variant="secondary" className="gap-1">
                    <Maximize2 className="h-3 w-3" />
                    {property.m2}
                  </Badge>
                  <Badge variant="secondary" className="gap-1">
                    <Home className="h-3 w-3" />
                    {property.quartos}
                  </Badge>
                  <Badge variant="secondary" className="gap-1">
                    <Car className="h-3 w-3" />
                    {property.garagem} vagas
                  </Badge>
                  {property.distancia && userLocation && (
                    <Badge variant="outline" className="gap-1 border-blue-200 text-blue-700">
                      <MapPin className="h-3 w-3" />
                      {property.distancia.toFixed(1)} km
                    </Badge>
                  )}
                </div>

                {/* Tags */}
                {property.tags && property.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-4">
                    {property.tags.map(tag => (
                      <Badge key={tag} variant="default" className="text-xs bg-purple-100 text-purple-800">
                        <Tag className="h-3 w-3 mr-1" />
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Vantagens */}
                {property.vantagens && (
                  <div className="mb-3">
                    <p className="text-xs font-medium text-gray-700 mb-1">Vantagens:</p>
                    <p className="text-xs text-gray-600 line-clamp-2">{property.vantagens}</p>
                  </div>
                )}

                {/* Palavras-chave */}
                {property.palavrasChaves && (
                  <div className="mb-4">
                    <p className="text-xs font-medium text-gray-700 mb-1">Palavras-chave:</p>
                    <div className="flex flex-wrap gap-1">
                      {property.palavrasChaves.split(',').slice(0, 3).map((palavra, index) => (
                        <Badge key={index} variant="outline" className="text-xs">
                          {palavra.trim()}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                                                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDislike(property.id)}
                      className="gap-1 text-xs sm:text-sm"
                    >
                      <ThumbsDown className="h-3 w-3 sm:h-4 sm:w-4" />
                      <span className="hidden sm:inline">Não</span>
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => window.open(property.link, '_blank')}
                      variant="outline"
                      className="text-xs sm:text-sm"
                    >
                      <span className="hidden sm:inline">Ver Detalhes</span>
                      <span className="sm:hidden">Ver</span>
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleLike(property.id)}
                      className="gap-1 bg-pink-600 hover:bg-pink-700 text-xs sm:text-sm"
                    >
                      <Heart className="h-3 w-3 sm:h-4 sm:w-4" />
                      <span className="hidden sm:inline">Sim</span>
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openTagModal(property)}
                    className="w-full gap-1 sm:gap-2 text-xs sm:text-sm"
                  >
                    <Tag className="h-3 w-3 sm:h-4 sm:w-4" />
                    <span className="hidden sm:inline">Adicionar Tag</span>
                    <span className="sm:hidden">Tag</span>
                  </Button>
                  <div className="text-xs text-center text-gray-500">
                    <span className="hidden sm:inline">← Arraste para rejeitar | Arraste para curtir →</span>
                    <span className="sm:hidden">Arraste ←→ ou use botões</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

                {filteredProperties.length === 0 && properties.length === 0 && (
          <Card className="bg-white/60 backdrop-blur-sm">
            <CardContent className="p-12 text-center">
              <Home className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Nenhum imóvel encontrado
              </h3>
              <p className="text-gray-600 mb-6">
                Inicie o scraping para come��ar a coletar dados reais do QuintoAndar ou importe um arquivo Excel
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button onClick={handleStartScraping} className="gap-2">
                  <Play className="h-4 w-4" />
                  Iniciar Coleta
                </Button>
                <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
                  <Upload className="h-4 w-4" />
                  Importar Excel
                </Button>
              </div>
            </CardContent>
          </Card>
                )}

        {filteredProperties.length === 0 && properties.length > 0 && (
          <Card className="bg-white/60 backdrop-blur-sm">
            <CardContent className="p-12 text-center">
              <Filter className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Nenhum imóvel encontrado com esses filtros
              </h3>
              <p className="text-gray-600 mb-6">
                Tente ajustar os filtros para ver mais resultados. Temos {properties.length} imóveis disponíveis.
              </p>
                            <Button
                variant="outline"
                                onClick={() => setFilters({
                  valorMin: "",
                  valorMax: "",
                  m2Min: 0,
                  m2Max: 2000,
                  quartos: "all",
                  vagas: "all",
                  distanciaMax: 100,
                  tags: []
                })}
              >
                Limpar Filtros
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

            {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* Match Mode Modal */}
      <Dialog open={isMatchModeOpen} onOpenChange={setIsMatchModeOpen}>
        <DialogContent className="w-[95vw] max-w-2xl h-[95vh] max-h-[95vh] overflow-hidden p-3 sm:p-6">
          <DialogHeader className="space-y-2 pb-2">
            <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <Zap className="h-4 w-4 sm:h-5 sm:w-5 text-purple-600" />
              <span className="hidden sm:inline">Modo Match - Tinder de Casas</span>
              <span className="sm:hidden">Match Mode</span>
            </DialogTitle>
            <div className="text-xs sm:text-sm text-gray-600">
              <span className="hidden sm:inline">Use as setas: ← rejeitar, → curtir, T para adicionar tag, Esc para sair</span>
              <span className="sm:hidden">Arraste: ← rejeitar, → curtir | Setas: ←�� | T = tag</span>
            </div>
          </DialogHeader>

          {matchModeProperties.length > 0 && currentMatchIndex < matchModeProperties.length && (
            <div className="overflow-y-auto flex-1 min-h-0">
              <div className="relative h-full">
                {(() => {
                  const property = matchModeProperties[currentMatchIndex];
                  return (
                    <Card
                      className={`overflow-hidden h-full flex flex-col cursor-pointer select-none transition-all duration-300 active:scale-95 ${
                        isSwipeAnimating ? (
                          swipeDirection === 'left' ? 'transform -translate-x-full rotate-12 opacity-0' :
                          swipeDirection === 'right' ? 'transform translate-x-full -rotate-12 opacity-0' : ''
                        ) : ''
                      }`}
                      onTouchStart={(e) => {
                        handleTouchStart(e, property.id);
                      }}
                      onTouchMove={(e) => {
                        handleTouchMove(e, property.id);

                        // Add visual feedback during swipe
                        if (touchStart && touchEnd) {
                          const distanceX = touchStart.x - touchEnd.x;
                          const card = e.currentTarget as HTMLElement;
                          const isLeftSwipe = distanceX > 10;
                          const isRightSwipe = distanceX < -10;

                          if (isLeftSwipe) {
                            card.style.transform = `translateX(-${Math.min(Math.abs(distanceX), 50)}px) rotate(${Math.min(Math.abs(distanceX) / 10, 5)}deg)`;
                            card.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                          } else if (isRightSwipe) {
                            card.style.transform = `translateX(${Math.min(Math.abs(distanceX), 50)}px) rotate(-${Math.min(Math.abs(distanceX) / 10, 5)}deg)`;
                            card.style.backgroundColor = 'rgba(34, 197, 94, 0.1)';
                          } else {
                            card.style.transform = '';
                            card.style.backgroundColor = '';
                          }
                        }
                      }}
                      onTouchEnd={(e) => {
                        const card = e.currentTarget as HTMLElement;

                        if (!touchStart || !touchEnd) {
                          // Reset card position
                          card.style.transform = '';
                          card.style.backgroundColor = '';
                          return;
                        }

                        const distanceX = touchStart.x - touchEnd.x;
                        const distanceY = touchStart.y - touchEnd.y;
                        const isLeftSwipe = distanceX > 30;
                        const isRightSwipe = distanceX < -30;
                        const isVerticalSwipe = Math.abs(distanceY) > Math.abs(distanceX);

                        if (!isVerticalSwipe && (isLeftSwipe || isRightSwipe)) {
                          // Start animation
                          setIsSwipeAnimating(true);
                          setSwipeDirection(isLeftSwipe ? 'left' : 'right');

                          // Execute action after animation
                          setTimeout(() => {
                            if (isLeftSwipe) {
                              handleMatchModeAction('dislike');
                            } else {
                              handleMatchModeAction('like');
                            }

                            // Reset animation state and card position
                            setIsSwipeAnimating(false);
                            setSwipeDirection(null);

                            // Ensure card returns to default position
                            card.style.transform = '';
                            card.style.backgroundColor = '';
                          }, 300);
                        } else {
                          // Reset card position for incomplete swipes
                          card.style.transform = '';
                          card.style.backgroundColor = '';
                        }

                        setTouchStart(null);
                        setTouchEnd(null);
                      }}
                    >
                      <div className="relative flex-shrink-0">
                        <img
                          src={currentImageIndex[property.id] === 1 && property.imagem2 ? property.imagem2 : property.imagem}
                          alt={property.nome}
                          className="w-full h-40 sm:h-48 md:h-64 object-cover cursor-pointer"
                          onClick={() => {
                            if (property.imagem2) {
                              setCurrentImageIndex(prev => ({
                                ...prev,
                                [property.id]: prev[property.id] === 1 ? 0 : 1
                              }));
                            }
                          }}
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=600&h=400&fit=crop";
                          }}
                        />
                        <Badge className="absolute top-2 right-2 sm:top-3 sm:right-3 bg-blue-600 text-xs sm:text-sm">
                          {currentMatchIndex + 1}/{matchModeProperties.length}
                        </Badge>
                        <Badge className="absolute top-2 left-2 sm:top-3 sm:left-3 bg-purple-600 text-xs sm:text-sm">
                          {property.site || 'QuintoAndar'}
                        </Badge>
                        {property.imagem2 && (
                          <div className="absolute bottom-2 right-2 sm:bottom-3 sm:right-3 flex gap-1">
                            <div className={`w-2 h-2 rounded-full ${currentImageIndex[property.id] === 0 ? 'bg-white' : 'bg-white/50'}`} />
                            <div className={`w-2 h-2 rounded-full ${currentImageIndex[property.id] === 1 ? 'bg-white' : 'bg-white/50'}`} />
                          </div>
                        )}
                      </div>

                      <CardContent className="p-3 sm:p-4 md:p-6 flex-1 overflow-y-auto">
                        <h3 className="font-bold text-lg sm:text-xl text-gray-900 mb-2 line-clamp-2">
                          {property.nome}
                        </h3>

                        <div className="flex items-start gap-2 mb-3">
                          <MapPin className="h-3 w-3 sm:h-4 sm:w-4 text-gray-500 mt-0.5 flex-shrink-0" />
                          <p className="text-xs sm:text-sm text-gray-600 line-clamp-2">{property.localizacao}</p>
                        </div>

                        <div className="text-xl sm:text-2xl md:text-3xl font-bold text-green-600 mb-2">
                          {property.valor}
                        </div>

                        {/* Condomínio */}
                        {property.condominio && (
                          <div className="text-sm text-gray-600 mb-3">
                            <span className="font-medium">Condomínio:</span> {property.condominio}
                          </div>
                        )}

                        {/* Endereço detalhado se disponível */}
                        {(property.rua || property.bairro) && (
                          <div className="flex items-start gap-2 mb-3">
                            <MapPin className="h-3 w-3 sm:h-4 sm:w-4 text-gray-500 mt-0.5 flex-shrink-0" />
                            <div className="text-xs sm:text-sm text-gray-600">
                              {property.rua && <p>{property.rua}</p>}
                              {property.bairro && <p>{property.bairro}</p>}
                            </div>
                          </div>
                        )}

                        <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-3 sm:mb-4">
                          <Badge variant="secondary" className="gap-1 text-xs">
                            <Maximize2 className="h-3 w-3" />
                            {property.m2}
                          </Badge>
                          <Badge variant="secondary" className="gap-1 text-xs">
                            <Home className="h-3 w-3" />
                            {property.quartos}
                          </Badge>
                          <Badge variant="secondary" className="gap-1 text-xs">
                            <Car className="h-3 w-3" />
                            {property.garagem} vagas
                          </Badge>
                          {property.distancia && userLocation && (
                            <Badge variant="outline" className="gap-1 border-blue-200 text-blue-700 text-xs">
                              <MapPin className="h-3 w-3" />
                              {property.distancia.toFixed(1)} km
                            </Badge>
                          )}
                        </div>

                        {/* Tags */}
                        {property.tags && property.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-3 sm:mb-4">
                            {property.tags.map(tag => (
                              <Badge key={tag} variant="default" className="text-xs bg-purple-100 text-purple-800">
                                <Tag className="h-3 w-3 mr-1" />
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}

                        {/* Vantagens */}
                        {property.vantagens && (
                          <div className="mb-3 sm:mb-4">
                            <p className="text-sm font-medium text-gray-700 mb-1">Vantagens:</p>
                            <p className="text-sm text-gray-600 line-clamp-3">{property.vantagens}</p>
                          </div>
                        )}

                        {/* Palavras-chave */}
                        {property.palavrasChaves && (
                          <div className="mb-4 sm:mb-5">
                            <p className="text-sm font-medium text-gray-700 mb-2">Palavras-chave:</p>
                            <div className="flex flex-wrap gap-1">
                              {property.palavrasChaves.split(',').slice(0, 4).map((palavra, index) => (
                                <Badge key={index} variant="outline" className="text-xs">
                                  {palavra.trim()}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="space-y-2 sm:space-y-3 mt-4 sm:mt-6">
                          <Button
                            onClick={() => setIsMatchModeTagModalOpen(true)}
                            variant="outline"
                            className="w-full gap-1 sm:gap-2 text-xs sm:text-sm py-2 sm:py-3"
                            size="sm"
                          >
                            <Tag className="h-3 w-3 sm:h-4 sm:w-4" />
                            <span className="hidden sm:inline">Adicionar Tag (T)</span>
                            <span className="sm:hidden">Tag (T)</span>
                          </Button>

                          <div className="space-y-2">
                            {/* Main action buttons - side by side on mobile */}
                            <div className="grid grid-cols-2 gap-2">
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleMatchModeAction('dislike')}
                                className="gap-1 sm:gap-2 text-xs sm:text-sm py-3 sm:py-4"
                              >
                                <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 md:h-5 md:w-5" />
                                <span className="hidden sm:inline">Rejeitar</span>
                                <span className="sm:hidden">👎</span>
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => handleMatchModeAction('like')}
                                className="gap-1 sm:gap-2 bg-pink-600 hover:bg-pink-700 text-xs sm:text-sm py-3 sm:py-4"
                              >
                                <ArrowRight className="h-3 w-3 sm:h-4 sm:w-4 md:h-5 md:w-5" />
                                <span className="hidden sm:inline">Curtir</span>
                                <span className="sm:hidden">❤️</span>
                              </Button>
                            </div>

                            {/* Ver detalhes button - full width */}
                            <Button
                              size="sm"
                              onClick={() => {
                                console.log('=== DEBUG BUTTON CLICK ===');
                                console.log('Property name:', property.nome);
                                console.log('Property link:', property.link);
                                console.log('Window width:', window.innerWidth);

                                if (!property.link || property.link === '#' || property.link.trim() === '') {
                                  console.log('Link inválido ou vazio');
                                  toast.error('Link não disponível para esta propriedade');
                                  return;
                                }

                                try {
                                  let url = property.link.trim();
                                  console.log('URL original:', url);

                                  // Ensure the link starts with http/https
                                  if (!url.startsWith('http://') && !url.startsWith('https://')) {
                                    url = 'https://' + url;
                                  }

                                  console.log('URL final:', url);

                                  // Simple direct navigation for mobile
                                  window.open(url, '_blank');
                                  toast.success('Abrindo link do imóvel...');

                                } catch (error) {
                                  console.error('Erro ao abrir link:', error);
                                  toast.error('Erro ao abrir o link: ' + error.message);
                                }
                              }}
                              variant="outline"
                              className="w-full gap-1 sm:gap-2 text-xs sm:text-sm py-3 sm:py-4"
                            >
                              <span className="hidden sm:inline">Ver Detalhes</span>
                              <span className="sm:hidden">🔗 Ver</span>
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}
              </div>
            </div>
          )}

          {matchModeProperties.length === 0 && (
            <div className="text-center py-8">
              <Zap className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">Todas as propriedades foram avaliadas!</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Site Selection Modal */}
      <Dialog open={isSelectSiteOpen} onOpenChange={setIsSelectSiteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Selecionar Site para Importação</DialogTitle>
            <p className="text-sm text-gray-600">
              Escolha o site de origem do arquivo XLSX para usar o mapeamento correto das colunas.
            </p>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'quintoandar', label: 'QuintoAndar' },
                { value: 'imovelnaweb', label: 'Imóvel na Web' },
                { value: 'olx', label: 'OLX' },
                { value: 'zapimoveis', label: 'ZAP Imóveis' },
                { value: 'vivareal', label: 'VivaReal' },
                { value: 'netimoveis', label: 'Netimóveis' },
                { value: 'loft', label: 'Loft' },
                { value: 'chavesnamao', label: 'Chaves na Mão' },
                { value: 'casamineira', label: 'Casa Mineira' }
              ].map((site) => (
                <Button
                  key={site.value}
                  variant={selectedSite === site.value ? "default" : "outline"}
                  onClick={() => setSelectedSite(site.value)}
                  className="justify-start text-sm h-auto py-2"
                >
                  {site.label}
                </Button>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setIsSelectSiteOpen(false);
                  setSelectedSite('');
                  setPendingFile(null);
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={processSelectedFile}
                disabled={!selectedSite}
              >
                Importar Arquivo
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Tag Modal */}
      <Dialog open={isTagModalOpen} onOpenChange={setIsTagModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar Tag</DialogTitle>
            {selectedPropertyForTag && (
              <p className="text-sm text-gray-600">
                Adicionando tag para: {selectedPropertyForTag.nome}
              </p>
            )}
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tag">Nome da Tag</Label>
              <Input
                id="tag"
                placeholder="Ex: Favorita, Próxima ao trabalho, Boa localização"
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    addNewTag();
                  }
                }}
              />
            </div>

            {availableTags.length > 0 && (
              <div className="space-y-2">
                <Label>Tags Existentes</Label>
                <div className="flex flex-wrap gap-1">
                  {availableTags.map(tag => (
                    <Badge
                      key={tag}
                      variant="outline"
                      className="cursor-pointer hover:bg-blue-50"
                      onClick={() => {
                        if (selectedPropertyForTag) {
                          addTagToProperty(selectedPropertyForTag.id, tag);
                          setIsTagModalOpen(false);
                          setSelectedPropertyForTag(null);
                          toast.success(`Tag "${tag}" adicionada!`);
                        }
                      }}
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <Button onClick={addNewTag} className="flex-1" disabled={!newTagInput.trim()}>
                Adicionar Nova Tag
              </Button>
              <Button variant="outline" onClick={() => {
                setIsTagModalOpen(false);
                setSelectedPropertyForTag(null);
                setNewTagInput("");
              }}>
                Cancelar
              </Button>
            </div>
          </div>
                </DialogContent>
      </Dialog>

      {/* Match Mode Tag Modal */}
      <Dialog open={isMatchModeTagModalOpen} onOpenChange={setIsMatchModeTagModalOpen}>
        <DialogContent className="w-[95vw] max-w-md max-h-[90vh] overflow-hidden">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-lg sm:text-xl">
              <span className="hidden sm:inline">Adicionar Tag no Modo Match</span>
              <span className="sm:hidden">Adicionar Tag</span>
            </DialogTitle>
            {currentMatchIndex < matchModeProperties.length && (
              <p className="text-xs sm:text-sm text-gray-600 line-clamp-2">
                <span className="hidden sm:inline">Adicionando tag para:</span>
                <span className="font-medium">{matchModeProperties[currentMatchIndex]?.nome}</span>
              </p>
            )}
          </DialogHeader>
          <div className="space-y-3 sm:space-y-4 overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor="matchTag" className="text-sm sm:text-base">Nome da Tag</Label>
              <Input
                id="matchTag"
                placeholder="Ex: Favorita, Boa localização"
                value={matchModeTagInput}
                onChange={(e) => setMatchModeTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    addNewTagInMatchMode();
                  } else if (e.key === 'Escape') {
                    setIsMatchModeTagModalOpen(false);
                    setMatchModeTagInput("");
                  }
                }}
                autoFocus
                className="text-sm sm:text-base"
              />
            </div>

            {availableTags.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm sm:text-base">Tags Existentes</Label>
                <div className="flex flex-wrap gap-1 max-h-24 sm:max-h-32 overflow-y-auto p-1 border rounded">
                  {availableTags.map(tag => {
                    const currentProperty = matchModeProperties[currentMatchIndex];
                    const hasTag = currentProperty?.tags?.includes(tag);
                    return (
                      <Badge
                        key={tag}
                        variant={hasTag ? "default" : "outline"}
                        className={`cursor-pointer text-xs transition-colors ${
                          hasTag
                            ? "bg-purple-100 text-purple-800"
                            : "hover:bg-blue-50"
                        }`}
                        onClick={() => {
                          if (!hasTag) {
                            addTagInMatchMode(tag);
                            setIsMatchModeTagModalOpen(false);
                            toast.success(`Tag "${tag}" adicionada!`);
                          }
                        }}
                      >
                        {hasTag && <Tag className="h-3 w-3 mr-1" />}
                        {tag}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 pt-2">
              <Button
                onClick={addNewTagInMatchMode}
                className="flex-1 text-sm sm:text-base"
                disabled={!matchModeTagInput.trim()}
                size="sm"
              >
                <span className="hidden sm:inline">Adicionar Nova Tag</span>
                <span className="sm:hidden">Adicionar Tag</span>
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setIsMatchModeTagModalOpen(false);
                  setMatchModeTagInput("");
                }}
                className="text-sm sm:text-base"
                size="sm"
              >
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
