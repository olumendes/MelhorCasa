import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Home, MapPin, Car, Maximize2, Tag, Filter, Plus, X, Search, Heart, ThumbsDown, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

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
  status?: 'liked' | 'disliked';
}

export default function CasasComTags() {
  const [likedProperties, setLikedProperties] = useState<Property[]>([]);
  const [dislikedProperties, setDislikedProperties] = useState<Property[]>([]);
  const [allProperties, setAllProperties] = useState<Property[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [filteredProperties, setFilteredProperties] = useState<Property[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'liked' | 'disliked'>('all');

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
    const savedLiked = localStorage.getItem('likedProperties');
    const savedDisliked = localStorage.getItem('dislikedProperties');
    const savedTags = localStorage.getItem('availableTags');
    
    let liked: Property[] = [];
    let disliked: Property[] = [];
    
    if (savedLiked) {
      try {
        const likedData = JSON.parse(savedLiked);
        const deduplicatedLiked = removeDuplicateProperties(likedData);
        liked = deduplicatedLiked.map(p => ({ ...p, status: 'liked' as const }));
        setLikedProperties(deduplicatedLiked);
      } catch (error) {
        console.error('Error loading liked properties:', error);
      }
    }
    
    if (savedDisliked) {
      try {
        const dislikedData = JSON.parse(savedDisliked);
        const deduplicatedDisliked = removeDuplicateProperties(dislikedData);
        disliked = deduplicatedDisliked.map(p => ({ ...p, status: 'disliked' as const }));
        setDislikedProperties(deduplicatedDisliked);
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

    // Combine both lists with their status
    const combined = [...liked, ...disliked];
    setAllProperties(combined);
  }, []);

  // Filter properties based on selected tags and status
  useEffect(() => {
    let filtered = allProperties;

    // Filter by status
    if (statusFilter === 'liked') {
      filtered = filtered.filter(p => p.status === 'liked');
    } else if (statusFilter === 'disliked') {
      filtered = filtered.filter(p => p.status === 'disliked');
    }

    // Filter by tags
    if (tagFilter.length > 0) {
      filtered = filtered.filter(property => 
        property.tags && tagFilter.some(tag => property.tags!.includes(tag))
      );
    }

    setFilteredProperties(filtered);
  }, [allProperties, tagFilter, statusFilter]);

  const removeFromLiked = (propertyId: string) => {
    const updatedLiked = likedProperties.filter(p => p.id !== propertyId);
    setLikedProperties(updatedLiked);
    localStorage.setItem('likedProperties', JSON.stringify(updatedLiked));
    
    // Update allProperties
    setAllProperties(prev => prev.filter(p => p.id !== propertyId));
    
    toast.success("Casa removida das curtidas!");
  };

  const moveToLiked = (propertyId: string) => {
    const property = dislikedProperties.find(p => p.id === propertyId);
    if (!property) return;

    // Remove from disliked
    const updatedDisliked = dislikedProperties.filter(p => p.id !== propertyId);
    setDislikedProperties(updatedDisliked);
    localStorage.setItem('dislikedProperties', JSON.stringify(updatedDisliked));

    // Add to liked
    const updatedLiked = [...likedProperties, property];
    setLikedProperties(updatedLiked);
    localStorage.setItem('likedProperties', JSON.stringify(updatedLiked));

    // Update allProperties
    setAllProperties(prev => prev.map(p => 
      p.id === propertyId ? { ...p, status: 'liked' as const } : p
    ));

    toast.success("Casa movida para curtidas!");
  };

  const moveToDisliked = (propertyId: string) => {
    const property = likedProperties.find(p => p.id === propertyId);
    if (!property) return;

    // Remove from liked
    const updatedLiked = likedProperties.filter(p => p.id !== propertyId);
    setLikedProperties(updatedLiked);
    localStorage.setItem('likedProperties', JSON.stringify(updatedLiked));

    // Add to disliked
    const updatedDisliked = [...dislikedProperties, property];
    setDislikedProperties(updatedDisliked);
    localStorage.setItem('dislikedProperties', JSON.stringify(updatedDisliked));

    // Update allProperties
    setAllProperties(prev => prev.map(p => 
      p.id === propertyId ? { ...p, status: 'disliked' as const } : p
    ));

    toast.success("Casa movida para rejeitadas!");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-50">
        <div className="container mx-auto px-3 sm:px-6 py-3 sm:py-4">
          <div className="space-y-3">
            {/* Top row - Logo and title */}
            <div className="flex items-center gap-2 sm:gap-3">
              <Link to="/">
                <Button variant="outline" size="sm" className="gap-1 sm:gap-2 text-xs sm:text-sm">
                  <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden xs:inline">Voltar</span>
                </Button>
              </Link>
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="p-1.5 sm:p-2 bg-purple-600 rounded-lg">
                  <Tag className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                </div>
                <div>
                  <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900">
                    <span className="hidden sm:inline">Casas com Tags</span>
                    <span className="sm:hidden">Tags</span>
                  </h1>
                  <p className="text-xs sm:text-sm text-gray-600 hidden xs:block">Todas as suas casas organizadas por tags</p>
                </div>
              </div>
            </div>

            {/* Status Filter - responsive */}
            <div className="grid grid-cols-3 gap-1.5 sm:flex sm:gap-2">
              <Button
                variant={statusFilter === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('all')}
                className="text-xs sm:text-sm"
              >
                Todas
              </Button>
              <Button
                variant={statusFilter === 'liked' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('liked')}
                className="gap-1 sm:gap-2 text-xs sm:text-sm"
              >
                <Heart className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Curtidas</span>
                <span className="sm:hidden">❤️</span>
              </Button>
              <Button
                variant={statusFilter === 'disliked' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('disliked')}
                className="gap-1 sm:gap-2 text-xs sm:text-sm"
              >
                <ThumbsDown className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Rejeitadas</span>
                <span className="sm:hidden">👎</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-6 md:py-8">
        {/* Tag Filter */}
        {availableTags.length > 0 && (
          <Card className="mb-8 bg-white/60 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Filtrar por Tags
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1 min-h-[2rem] p-2 border rounded-md bg-white">
                  {tagFilter.length === 0 ? (
                    <span className="text-sm text-gray-400">Selecione tags para filtrar</span>
                  ) : (
                    tagFilter.map(tag => (
                      <Badge 
                        key={tag} 
                        variant="secondary" 
                        className="cursor-pointer hover:bg-red-100"
                        onClick={() => setTagFilter(prev => prev.filter(t => t !== tag))}
                      >
                        {tag} <X className="h-3 w-3 ml-1" />
                      </Badge>
                    ))
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {availableTags.filter(tag => !tagFilter.includes(tag)).map(tag => (
                    <Badge 
                      key={tag} 
                      variant="outline" 
                      className="cursor-pointer hover:bg-blue-50"
                      onClick={() => setTagFilter(prev => [...prev, tag])}
                    >
                      <Plus className="h-3 w-3 mr-1" /> {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Statistics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6 mb-6 sm:mb-8">
          <Card className="bg-white/60 backdrop-blur-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total</p>
                  <p className="text-3xl font-bold text-purple-600">
                    {filteredProperties.length}
                    {filteredProperties.length !== allProperties.length && (
                      <span className="text-lg text-gray-500">/{allProperties.length}</span>
                    )}
                  </p>
                </div>
                <Home className="h-8 w-8 text-purple-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-white/60 backdrop-blur-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Curtidas</p>
                  <p className="text-3xl font-bold text-green-600">{likedProperties.length}</p>
                </div>
                <Heart className="h-8 w-8 text-green-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/60 backdrop-blur-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Rejeitadas</p>
                  <p className="text-3xl font-bold text-red-600">{dislikedProperties.length}</p>
                </div>
                <ThumbsDown className="h-8 w-8 text-red-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-white/60 backdrop-blur-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Tags Disponíveis</p>
                  <p className="text-3xl font-bold text-blue-600">{availableTags.length}</p>
                </div>
                <Tag className="h-8 w-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Properties Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {filteredProperties.map((property) => (
            <Card key={property.id} className="overflow-hidden bg-white/80 backdrop-blur-sm hover:shadow-lg transition-all duration-300">
              <div className="relative">
                <img
                  src={property.imagem}
                  alt={property.nome}
                  className="w-full h-48 object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=400&h=300&fit=crop";
                  }}
                />
                <Badge className={`absolute top-3 right-3 ${
                  property.status === 'liked' ? 'bg-green-600' : 'bg-red-600'
                }`}>
                  {property.status === 'liked' ? 'Curtida' : 'Rejeitada'}
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
                
                <div className="space-y-2">
                  <div className="flex gap-2">
                    {property.status === 'liked' ? (
                      <>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => removeFromLiked(property.id)}
                          className="flex-1 gap-2"
                        >
                          <Trash2 className="h-4 w-4" />
                          Remover
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => window.open(property.link, '_blank')}
                          variant="outline"
                          className="flex-1"
                        >
                          Ver Detalhes
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => moveToDisliked(property.id)}
                          className="flex-1 gap-2"
                        >
                          <ThumbsDown className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          onClick={() => moveToLiked(property.id)}
                          className="flex-1 gap-2 bg-green-600 hover:bg-green-700"
                        >
                          <Heart className="h-4 w-4" />
                          Curtir
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => window.open(property.link, '_blank')}
                          variant="outline"
                          className="flex-1"
                        >
                          Ver Detalhes
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredProperties.length === 0 && allProperties.length === 0 && (
          <Card className="bg-white/60 backdrop-blur-sm">
            <CardContent className="p-12 text-center">
              <Tag className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Nenhuma casa com tags ainda
              </h3>
              <p className="text-gray-600 mb-6">
                Comece curtindo ou rejeitando casas e adicionando tags para vê-las aqui
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

        {filteredProperties.length === 0 && allProperties.length > 0 && (
          <Card className="bg-white/60 backdrop-blur-sm">
            <CardContent className="p-12 text-center">
              <Search className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Nenhuma casa encontrada
              </h3>
              <p className="text-gray-600 mb-6">
                Tente ajustar os filtros. Você tem {allProperties.length} casas com tags.
              </p>
              <div className="flex gap-3 justify-center">
                <Button variant="outline" onClick={() => setTagFilter([])}>
                  Limpar Tags
                </Button>
                <Button variant="outline" onClick={() => setStatusFilter('all')}>
                  Mostrar Todas
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
