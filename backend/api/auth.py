from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        data = super().validate(attrs)
        data["user_id"]   = self.user.id
        data["username"]  = self.user.username
        data["role"]      = self.user.role
        data["unit_id"]   = self.user.unit_id
        data["unit_type"] = self.user.unit.type if self.user.unit_id else None
        return data


class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer
