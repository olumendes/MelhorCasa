import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Home, MapPin, Car, Maximize2, Trash2, RotateCcw, Tag, Filter, Plus, X, Search } from "lucide-react";
import { Link } from "react-router-dom";

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
  latitude?: number;
  longitude?: number;
  valorNumerico?: number;
  m2Numerico?: number;
  quartosNumerico?: number;
  garagemNumerico?: number;
  distancia?: number;
  tags?: string[];
}

export default function Dislikes() {
  const [dislikedProperties, setDislikedProperties] = useState<Property[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [filteredProperties, setFilteredProperties] = useState<Property[]>([]);

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

    useEffect(() => {
    const savedDislikes = localStorage.getItem('dislikedProperties');
    const savedTags = localStorage.getItem('availableTags');

    if (savedDislikes) {
      try {
        const dislikedData = JSON.parse(savedDislikes);
        const deduplicatedDislikes = removeDuplicateProperties(dislikedData);
        setDislikedProperties(deduplicatedDislikes);

        // Update localStorage if duplicates were found
        if (deduplicatedDislikes.length !== dislikedData.length) {
          localStorage.setItem('dislikedProperties', JSON.stringify(deduplicatedDislikes));
          console.log(`Removed ${dislikedData.length - deduplicatedDislikes.length} duplicate disliked properties`);
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

  // Filter properties based on selected tags
  useEffect(() => {
    if (tagFilter.length === 0) {
      setFilteredProperties(dislikedProperties);
    } else {
      const filtered = dislikedProperties.filter(property =>
        property.tags && tagFilter.some(tag => property.tags!.includes(tag))
      );
      setFilteredProperties(filtered);
    }
  }, [dislikedProperties, tagFilter]);

  const removeFromDislikes = (propertyId: string) => {
    const updatedDislikes = dislikedProperties.filter(p => p.id !== propertyId);
    setDislikedProperties(updatedDislikes);
    localStorage.setItem('dislikedProperties', JSON.stringify(updatedDislikes));
  };

  const clearAllDislikes = () => {
    setDislikedProperties([]);
    localStorage.removeItem('dislikedProperties');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-50">
        <div className="container mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link to="/">
                <Button variant="outline" size="sm" className="gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Voltar
                </Button>
              </Link>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Casas Rejeitadas</h1>
                <p className="text-sm text-gray-600">Imóveis que você não curtiu</p>
              </div>
            </div>
            
            {dislikedProperties.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={clearAllDislikes}
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Limpar Tudo
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Statistics */}
        <Card className="mb-8 bg-white/60 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Rejeitadas</p>
                <p className="text-3xl font-bold text-red-600">{dislikedProperties.length}</p>
              </div>
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <span className="text-red-600 text-xl">👎</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Properties Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {dislikedProperties.map((property) => (
            <Card key={property.id} className="overflow-hidden bg-white/80 backdrop-blur-sm hover:shadow-lg transition-all duration-300">
              <div className="relative">
                <img
                  src={property.imagem}
                  alt={property.nome}
                  className="w-full h-48 object-cover opacity-75"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=400&h=300&fit=crop";
                  }}
                />
                <Badge className="absolute top-3 right-3 bg-red-600">
                  Rejeitada
                </Badge>
              </div>
              
              <CardContent className="p-6">
                <h3 className="font-bold text-lg text-gray-900 mb-2 line-clamp-2">
                  {property.nome}
                </h3>
                
                <div className="flex items-center gap-2 mb-3">
                  <MapPin className="h-4 w-4 text-gray-500" />
                  <p className="text-sm text-gray-600 line-clamp-1">{property.localizacao}</p>
                </div>
                
                <div className="text-2xl font-bold text-green-600 mb-4">
                  {property.valor}
                </div>
                
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
                  {property.distancia && (
                    <Badge variant="outline" className="gap-1 border-blue-200 text-blue-700">
                      <MapPin className="h-3 w-3" />
                      {property.distancia.toFixed(1)} km
                    </Badge>
                  )}
                </div>
                
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => removeFromDislikes(property.id)}
                    className="flex-1 gap-2"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reconsiderar
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => window.open(property.link, '_blank')}
                    className="flex-1"
                  >
                    Ver Detalhes
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {dislikedProperties.length === 0 && (
          <Card className="bg-white/60 backdrop-blur-sm">
            <CardContent className="p-12 text-center">
              <div className="text-6xl mb-4">😊</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Nenhuma casa rejeitada
              </h3>
              <p className="text-gray-600 mb-6">
                Você ainda não rejeitou nenhum imóvel. Continue procurando a casa dos seus sonhos!
              </p>
              <Link to="/">
                <Button className="gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Voltar para a busca
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
